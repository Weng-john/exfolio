/**
 * Exfolio backend for Google Apps Script, storing data in Google Sheets.
 *
 * Speaks the same protocol as the local Node backend (src/core/api.ts):
 * one POST with a JSON body { action, session, ... }. Access is per member:
 * accounts, sessions and admin actions mirror server/auth.ts.
 *
 * Storage layout
 *   Control spreadsheet (the bound one, or SHEET_ID):
 *     _users, _sessions, _config, _audit
 *   One spreadsheet per member (created with SpreadsheetApp.create on first
 *   save, its id recorded on the member's _users row): the data tables plus
 *   `_meta` for the revision.
 *
 * Script properties (Project Settings -> Script properties):
 *   SHEET_ID          optional. Control spreadsheet to use when the script
 *                     is not bound to one.
 *   GOOGLE_CLIENT_ID  optional. OAuth client id for Google sign-in; takes
 *                     precedence over the one an admin saved on the site.
 *   ADMIN_EMAILS      Comma-separated Google addresses that become active
 *                     admins the first time they sign in with Google. With
 *                     password accounts off this is the only way to get an
 *                     admin, so set it before sharing the site.
 *   PASSWORD_LOGIN    'on' to allow username/password accounts. Off by
 *                     default: members sign in with Google only.
 *   MAX_MEMBERS       optional, default 200. No new accounts beyond this.
 *   MAX_PENDING       optional, default 30. No new accounts while this many
 *                     wait for approval.
 *
 * Nothing secret belongs in this file: it is committed to the repository.
 */

var TABLES = [
  'brokers', 'accounts', 'indices', 'instruments', 'transactions', 'loans',
  'prices', 'fxRates', 'targets', 'strategies', 'snapshots', 'settings',
  'tradeGroups', 'rotationCycles', 'priceHistory', 'rollovers', 'cashflowItems', 'scenarios', 'importProfiles'
];
var META_SHEET = '_meta';
var JSON_COLUMN = '_json';
var USERS_SHEET = '_users';
var SESSIONS_SHEET = '_sessions';
var CONFIG_SHEET = '_config';
var AUDIT_SHEET = '_audit';

// Fields kept only inside the `_json` cell, never copied to a readable column.
var USER_HIDDEN = ['passwordSalt', 'passwordHash', 'passwordRounds', 'googleSub'];
var SESSION_HIDDEN = ['tokenHash'];

var SESSION_DAYS = 30;
var MAX_FAILURES = 8;
var FAILURE_WINDOW_SECONDS = 15 * 60;
var MAX_AUDIT = 1000;
var LOCK_WAIT_MS = 20000;
var QUOTE_TTL_SECONDS = 20;
var DEFAULT_MAX_MEMBERS = 200;
var DEFAULT_MAX_PENDING = 30;

/**
 * PBKDF2-HMAC-SHA-256 rounds applied to the browser's passwordKey. The
 * expensive stretching (200,000 PBKDF2 iterations) already happened in the
 * browser, so the key arriving here is a high-cost-to-guess 256-bit value.
 * This step only adds a per-member salt and keeps a copy of the spreadsheet
 * from being a list of directly replayable login keys. Every round is one
 * Utilities service call, which is slow in Apps Script, so the count stays
 * low to keep a login fast. The rounds used are stored per member, so the
 * constant can be raised later without locking anyone out.
 */
var PASSWORD_ROUNDS = 1000;
var DUMMY_SALT = '00000000000000000000000000000000';

var lockDepth_ = 0;

function doGet() {
  return json_({ ok: false, error: 'Use POST' });
}

function doPost(e) {
  var response;
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!request || typeof request !== 'object') request = {};
    response = route_(request);
  } catch (err) {
    response = { ok: false, error: err instanceof ApiError_ ? err.code : String((err && err.message) || err) };
  }
  return json_(response);
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/** A failure the client reacts to (see ApiErrorCode in src/core/api.ts). */
function ApiError_(code) {
  this.code = code;
  this.message = code;
}

// ---- Routing -----------------------------------------------------------
// Same order as server/handler.ts: open actions, sign-in actions, then
// everything else behind a valid session of an active member. With no valid
// session nothing below the second switch runs: no member data, no quotes.

function route_(request) {
  switch (request.action) {
    case 'ping':
      return { ok: true, backend: 'gas' };
    case 'config':
      return { ok: true, config: publicConfig_(loadAuth_()) };
    case 'register':
      requirePasswordLogin_();
      return withOk_(register_(request));
    case 'login':
      requirePasswordLogin_();
      return withOk_(login_(request));
    case 'loginGoogle':
      return withOk_(loginGoogle_(request));
    case 'logout':
      logout_(request.session);
      return { ok: true };
  }

  var a = loadAuth_();
  var user = authenticate_(a, request.session);
  switch (request.action) {
    case 'me':
      return { ok: true, user: toPublic_(user) };
    case 'updateProfile':
      return { ok: true, user: updateProfile_(request) };
    case 'changePassword':
      requirePasswordLogin_();
      return { ok: true, user: changePassword_(request) };
    case 'linkGoogle':
      return { ok: true, user: linkGoogle_(request) };
    case 'adminUsers':
      requireAdmin_(user);
      return { ok: true, users: a.users.map(toPublic_) };
    case 'adminUpdateUser':
      return { ok: true, user: adminUpdateUser_(request) };
    case 'adminDeleteUser':
      adminDeleteUser_(request);
      return { ok: true };
    case 'adminSetConfig':
      return { ok: true, config: adminSetConfig_(request) };
    case 'adminAudit':
      requireAdmin_(user);
      return { ok: true, audit: a.audit.slice().reverse() };
    case 'load':
      return load_(request);
    case 'save':
      return save_(request);
    case 'quotes':
      return { ok: true, quotes: fetchQuotes_(request.items || []) };
    case 'history':
      return { ok: true, history: fetchHistory_(request.items || [], request.from) };
    default:
      return { ok: false, error: 'Unknown action: ' + request.action };
  }
}

function withOk_(result) {
  result.ok = true;
  return result;
}

// ---- Locking -----------------------------------------------------------

/**
 * Runs `fn` while holding the script lock, so two requests never interleave
 * their read-modify-write of the sheets. Re-entrant within one execution.
 */
function locked_(fn) {
  if (lockDepth_ > 0) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  lockDepth_++;
  try {
    return fn();
  } finally {
    lockDepth_--;
    lock.releaseLock();
  }
}

/** Fresh state under the lock; saved only when `change` returns normally. */
function mutate_(change) {
  return locked_(function () {
    var a = loadAuth_();
    var result = change(a);
    commitAuth_(a);
    return result;
  });
}

/** Like mutate_, but re-checks the session inside the lock. */
function mutateAs_(session, change) {
  return mutate_(function (a) {
    return change(a, authenticate_(a, session));
  });
}

// ---- Crypto helpers ----------------------------------------------------
// Apps Script has no `crypto`: only Utilities. Byte arrays there are signed.

function toSigned_(b) {
  return b > 127 ? b - 256 : b;
}

function hexOf_(bytes) {
  return bytes.map(function (b) { return ((b & 0xff) + 256).toString(16).slice(1); }).join('');
}

function hexToBytes_(hex) {
  var out = [];
  for (var i = 0; i + 1 < hex.length; i += 2) out.push(toSigned_(parseInt(hex.substr(i, 2), 16)));
  return out;
}

function sha256Hex_(text) {
  return hexOf_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
}

/**
 * PBKDF2-HMAC-SHA-256, one 32-byte block, built on the HMAC service so the
 * result equals a standard PBKDF2 (the tests compare it with Node's).
 */
function hashKey_(passwordKey, saltHex, rounds) {
  var password = hexToBytes_(passwordKey);
  var u = Utilities.computeHmacSha256Signature(hexToBytes_(saltHex).concat([0, 0, 0, 1]), password);
  var t = u.slice();
  for (var i = 1; i < rounds; i++) {
    u = Utilities.computeHmacSha256Signature(u, password);
    for (var j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return hexOf_(t);
}

/** Compare without stopping at the first differing character. */
function safeEqual_(a, b) {
  var diff = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) {
    diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function newSalt_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 32);
}

function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

/**
 * 256-bit session token: SHA-256 over four UUIDs plus the clock and
 * Math.random. Utilities.getUuid() is a random (version 4) UUID; Google does
 * not document its generator, so we rely on it being a secure random source
 * (122 random bits each, 488 across four). Time and Math.random only stir
 * the mix, they are not counted as entropy. Only the SHA-256 of the token is
 * stored, so a copy of the sheet does not yield usable sessions.
 */
function newToken_() {
  var parts = [];
  for (var i = 0; i < 4; i++) parts.push(Utilities.getUuid());
  parts.push(String(Date.now()), String(Math.random()));
  return sha256Hex_(parts.join('|'));
}

// ---- Control sheets: users, sessions, config, audit ----------------------
// Each is stored like a data table: full row as JSON in `_json`, readable
// mirror columns beside it. Secret fields live only inside `_json`; anyone
// who can open the control spreadsheet can still read them there.

function loadAuth_() {
  var ss = spreadsheet_();
  var raw = readTable_(ss, CONFIG_SHEET)[0] || {};
  var a = {
    ss: ss,
    users: readTable_(ss, USERS_SHEET),
    sessions: readTable_(ss, SESSIONS_SHEET),
    audit: readTable_(ss, AUDIT_SHEET),
    config: { registration: raw.registration === 'open' ? 'open' : 'approval' }
  };
  if (raw.googleClientId) a.config.googleClientId = raw.googleClientId;
  a.clientId = property_('GOOGLE_CLIENT_ID') || a.config.googleClientId;
  if (raw.legacyHandedOver) a.config.legacyHandedOver = raw.legacyHandedOver;
  a.saved = snapshot_(a);
  return a;
}

function snapshot_(a) {
  return {
    users: JSON.stringify(a.users),
    sessions: JSON.stringify(a.sessions),
    audit: JSON.stringify(a.audit),
    config: JSON.stringify(a.config)
  };
}

/** Writes back only the control sheets that changed. Prunes on every write. */
function commitAuth_(a) {
  var now = Date.now();
  a.sessions = a.sessions.filter(function (s) { return new Date(s.expiresAt).getTime() > now; });
  if (a.audit.length > MAX_AUDIT) a.audit = a.audit.slice(-MAX_AUDIT);
  var after = snapshot_(a);
  if (after.users !== a.saved.users) writeTable_(a.ss, USERS_SHEET, a.users, USER_HIDDEN);
  if (after.sessions !== a.saved.sessions) writeTable_(a.ss, SESSIONS_SHEET, a.sessions, SESSION_HIDDEN);
  if (after.audit !== a.saved.audit) writeTable_(a.ss, AUDIT_SHEET, a.audit, []);
  if (after.config !== a.saved.config) writeTable_(a.ss, CONFIG_SHEET, [a.config], []);
  a.saved = after;
}

function audit_(a, actor, action, target, detail) {
  var entry = {
    id: newId_('audit'),
    at: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.username,
    action: action
  };
  if (target) {
    entry.targetId = target.id;
    entry.targetName = target.username;
  }
  if (detail) entry.detail = detail;
  a.audit.push(entry);
}

function publicConfig_(a) {
  var config = {
    authRequired: true,
    registration: a.config.registration,
    hasUsers: a.users.length > 0,
    passwordLogin: passwordLogin_()
  };
  if (a.clientId) config.googleClientId = a.clientId;
  return config;
}

// ---- Deployment settings (script properties) ---------------------------------

function property_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  return value === null || value === undefined ? '' : String(value).trim();
}

function passwordLogin_() {
  return property_('PASSWORD_LOGIN').toLowerCase() === 'on';
}

function requirePasswordLogin_() {
  if (!passwordLogin_()) throw new ApiError_('password_disabled');
}

function limit_(name, fallback) {
  var n = parseInt(property_(name), 10);
  return n > 0 ? n : fallback;
}

/** Google addresses allowed to become admin on their first Google sign-in. */
function adminEmails_() {
  return property_('ADMIN_EMAILS').split(',')
    .map(function (e) { return e.trim().toLowerCase(); })
    .filter(function (e) { return e; });
}

/** Refuse new accounts once the deployment is full or the queue is long. */
function requireRoom_(a) {
  if (a.users.length >= limit_('MAX_MEMBERS', DEFAULT_MAX_MEMBERS)) throw new ApiError_('registration_full');
  var pending = a.users.filter(function (u) { return u.status === 'pending'; }).length;
  if (pending >= limit_('MAX_PENDING', DEFAULT_MAX_PENDING)) throw new ApiError_('registration_full');
}

function toPublic_(u) {
  var user = {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    allowAdminView: u.allowAdminView,
    hasPassword: Boolean(u.passwordHash),
    googleLinked: Boolean(u.googleSub),
    createdAt: u.createdAt
  };
  if (u.lastLoginAt) user.lastLoginAt = u.lastLoginAt;
  return user;
}

// ---- Validation ----------------------------------------------------------

function normalizeUsername_(raw) {
  var username = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
  if (!/^[a-z0-9._@+-]{3,64}$/.test(username)) {
    throw new ApiError_('帳號需為 3–64 個字元，只能使用英數字與 . _ @ + -');
  }
  return username;
}

function requireKey_(raw) {
  var key = String(raw === undefined || raw === null ? '' : raw);
  if (!/^[0-9a-f]{64}$/.test(key)) throw new ApiError_('密碼格式不正確');
  return key;
}

function cleanName_(raw, fallback) {
  var name = String(raw === undefined || raw === null ? '' : raw).trim().slice(0, 80);
  return name || fallback;
}

function findUser_(a, userId) {
  for (var i = 0; i < a.users.length; i++) {
    if (a.users[i].id === userId) return a.users[i];
  }
  throw new ApiError_('找不到這個帳號');
}

function requireActive_(user) {
  if (user.status === 'pending') throw new ApiError_('pending');
  if (user.status === 'disabled') throw new ApiError_('disabled');
}

function requireAdmin_(user) {
  if (user.role !== 'admin') throw new ApiError_('forbidden');
}

function activeAdmins_(a) {
  return a.users.filter(function (u) { return u.role === 'admin' && u.status === 'active'; });
}

function setPassword_(user, passwordKey) {
  user.passwordSalt = newSalt_();
  user.passwordRounds = PASSWORD_ROUNDS;
  user.passwordHash = hashKey_(passwordKey, user.passwordSalt, PASSWORD_ROUNDS);
}

function dropSessions_(a, userId, keepHash) {
  a.sessions = a.sessions.filter(function (s) { return s.userId !== userId || s.tokenHash === keepHash; });
}

// ---- Sessions ---------------------------------------------------------------

function openSession_(a, user) {
  var token = newToken_();
  a.sessions.push({
    tokenHash: sha256Hex_(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString()
  });
  user.lastLoginAt = new Date().toISOString();
  return token;
}

/** The active member behind a session token, or an error. */
function authenticate_(a, session) {
  if (typeof session !== 'string' || !session) throw new ApiError_('unauthenticated');
  var tokenHash = sha256Hex_(session);
  var record = null;
  for (var i = 0; i < a.sessions.length; i++) {
    if (a.sessions[i].tokenHash === tokenHash) record = a.sessions[i];
  }
  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) throw new ApiError_('unauthenticated');
  var user = null;
  for (var j = 0; j < a.users.length; j++) {
    if (a.users[j].id === record.userId) user = a.users[j];
  }
  if (!user) throw new ApiError_('unauthenticated');
  requireActive_(user);
  return user;
}

function logout_(session) {
  var tokenHash = sha256Hex_(String(session === undefined || session === null ? '' : session));
  mutate_(function (a) {
    a.sessions = a.sessions.filter(function (s) { return s.tokenHash !== tokenHash; });
  });
}

// ---- Login throttling ------------------------------------------------------
// Per username, kept in CacheService. Best effort only: the cache may evict
// entries early, so the limit can reset sooner than 15 minutes. Like the Node
// backend it limits by account name, so someone who knows a username can
// block that account's password login for a while.

function throttleKey_(username) {
  return 'login_fail:' + sha256Hex_(username);
}

function checkThrottle_(username) {
  var raw = CacheService.getScriptCache().get(throttleKey_(username));
  if (raw && JSON.parse(raw).count >= MAX_FAILURES) throw new ApiError_('rate_limited');
}

function recordFailure_(username) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(throttleKey_(username));
  var now = Date.now();
  var f = raw ? JSON.parse(raw) : { count: 0, since: now };
  f.count += 1;
  // Fixed window from the first failure: keep the original expiry.
  var left = Math.ceil(FAILURE_WINDOW_SECONDS - (now - f.since) / 1000);
  cache.put(throttleKey_(username), JSON.stringify(f), Math.max(1, left));
}

function clearFailures_(username) {
  CacheService.getScriptCache().remove(throttleKey_(username));
}

// ---- Public operations -----------------------------------------------------

/**
 * Create a member. An admin comes from one of two rules: a Google identity
 * whose verified address is an admin address (ADMIN_EMAILS, or the deployer),
 * or, only when password accounts are on, the very first account.
 */
function createUser_(a, fields) {
  var first = a.users.length === 0;
  var byEmail = Boolean(fields.verifiedEmail) && adminEmails_().indexOf(fields.verifiedEmail) >= 0;
  var admin = byEmail || (first && passwordLogin_());
  if (!admin) requireRoom_(a);
  var noAdminYet = activeAdmins_(a).length === 0;
  var user = {
    id: newId_('u'),
    username: fields.username,
    displayName: fields.displayName || fields.username,
    role: admin ? 'admin' : 'member',
    status: admin || a.config.registration === 'open' ? 'active' : 'pending',
    // On while the product is in testing; each member can turn it off.
    allowAdminView: true,
    createdAt: new Date().toISOString()
  };
  if (fields.passwordHash) {
    user.passwordSalt = fields.passwordSalt;
    user.passwordRounds = fields.passwordRounds;
    user.passwordHash = fields.passwordHash;
  }
  if (fields.googleSub) user.googleSub = fields.googleSub;
  a.users.push(user);
  audit_(a, user, 'register', null,
    byEmail ? 'admin address: admin' : admin ? 'first account: admin' : user.status);
  if (admin && noAdminYet) handOverLegacy_(a, user);
  return user;
}

function register_(request) {
  var username = normalizeUsername_(request.username);
  var key = requireKey_(request.passwordKey);
  return mutate_(function (a) {
    if (a.users.some(function (u) { return u.username === username; })) throw new ApiError_('username_taken');
    var salt = newSalt_();
    var user = createUser_(a, {
      username: username,
      displayName: cleanName_(request.displayName, username),
      passwordSalt: salt,
      passwordRounds: PASSWORD_ROUNDS,
      passwordHash: hashKey_(key, salt, PASSWORD_ROUNDS)
    });
    var session = user.status === 'active' ? openSession_(a, user) : undefined;
    var result = { user: toPublic_(user) };
    if (session) result.session = session;
    return result;
  });
}

function login_(request) {
  var username = String(request.username === undefined || request.username === null ? '' : request.username)
    .trim().toLowerCase();
  var key = requireKey_(request.passwordKey);
  checkThrottle_(username);
  return mutate_(function (a) {
    var user = null;
    for (var i = 0; i < a.users.length; i++) {
      if (a.users[i].username === username) user = a.users[i];
    }
    // Hash even for an unknown account, so timing does not reveal which exist.
    var salt = (user && user.passwordSalt) || DUMMY_SALT;
    var rounds = (user && user.passwordRounds) || PASSWORD_ROUNDS;
    var hash = hashKey_(key, salt, rounds);
    if (!user || !user.passwordHash || !safeEqual_(hash, user.passwordHash)) {
      recordFailure_(username);
      throw new ApiError_('invalid_credentials');
    }
    requireActive_(user);
    clearFailures_(username);
    var session = openSession_(a, user);
    return { user: toPublic_(user), session: session };
  });
}

function loginGoogle_(request) {
  var clientId = loadAuth_().clientId;
  var identity = googleIdentity_(clientId, request.idToken);
  return mutate_(function (a) {
    if (a.clientId !== clientId) throw new ApiError_('invalid_credentials');
    var user = null;
    for (var i = 0; i < a.users.length; i++) {
      if (a.users[i].googleSub === identity.sub) user = a.users[i];
    }
    if (!user) {
      // Never attach to an existing account by matching names: whoever chose
      // that username first has not proven they own the Google address.
      var username = normalizeUsername_(identity.email);
      while (a.users.some(function (u) { return u.username === username; })) {
        username = username.slice(0, 56) + '+' + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
      }
      user = createUser_(a, {
        username: username,
        displayName: cleanName_(identity.name, identity.email),
        googleSub: identity.sub,
        verifiedEmail: String(identity.email || '').trim().toLowerCase()
      });
    }
    if (user.status !== 'active') return { user: toPublic_(user) };
    var session = openSession_(a, user);
    return { user: toPublic_(user), session: session };
  });
}

function updateProfile_(request) {
  return mutateAs_(request.session, function (a, actor) {
    var user = findUser_(a, actor.id);
    if (request.displayName !== undefined) user.displayName = cleanName_(request.displayName, user.username);
    if (typeof request.allowAdminView === 'boolean' && request.allowAdminView !== user.allowAdminView) {
      user.allowAdminView = request.allowAdminView;
      audit_(a, user, 'set-admin-view', null, request.allowAdminView ? 'allowed' : 'refused');
    }
    return toPublic_(user);
  });
}

function changePassword_(request) {
  var next = requireKey_(request.newPasswordKey);
  return mutateAs_(request.session, function (a, actor) {
    var user = findUser_(a, actor.id);
    if (user.passwordHash) {
      var old = requireKey_(request.oldPasswordKey);
      var check = hashKey_(old, user.passwordSalt, user.passwordRounds || PASSWORD_ROUNDS);
      if (!safeEqual_(check, user.passwordHash)) throw new ApiError_('invalid_credentials');
    }
    setPassword_(user, next);
    // Sign out every other device.
    dropSessions_(a, user.id, sha256Hex_(String(request.session)));
    audit_(a, user, 'change-password', null, '');
    return toPublic_(user);
  });
}

function linkGoogle_(request) {
  var clientId = loadAuth_().clientId;
  var identity = googleIdentity_(clientId, request.idToken);
  return mutateAs_(request.session, function (a, actor) {
    if (a.clientId !== clientId) throw new ApiError_('invalid_credentials');
    if (a.users.some(function (u) { return u.googleSub === identity.sub && u.id !== actor.id; })) {
      throw new ApiError_('這個 Google 帳號已綁定其他會員');
    }
    var user = findUser_(a, actor.id);
    user.googleSub = identity.sub;
    audit_(a, user, 'link-google', null, '');
    return toPublic_(user);
  });
}

// ---- Google sign-in --------------------------------------------------------

/** Ask Google to validate the token, then check it was issued for this app. */
function googleIdentity_(clientId, idToken) {
  if (!clientId) throw new ApiError_('尚未啟用 Google 登入');
  if (typeof idToken !== 'string' || !idToken) throw new ApiError_('invalid_credentials');
  try {
    var response = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200) throw new Error('rejected');
    var info = JSON.parse(response.getContentText());
    var issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
    var fresh = Number(info.exp) * 1000 > Date.now();
    if (info.aud !== clientId || !issuerOk || !fresh || String(info.email_verified) !== 'true' || !info.sub) {
      throw new Error('invalid token');
    }
    return { sub: String(info.sub), email: info.email, name: info.name };
  } catch (err) {
    // Whatever went wrong, the caller learns only that sign-in failed.
    throw new ApiError_('invalid_credentials');
  }
}

// ---- Admin operations ------------------------------------------------------

function adminUpdateUser_(request) {
  return mutateAs_(request.session, function (a, actor) {
    requireAdmin_(actor);
    var user = findUser_(a, String(request.userId));
    var status = request.status;
    var role = request.role;
    if (status !== undefined && ['pending', 'active', 'disabled'].indexOf(status) < 0) throw new ApiError_('狀態不正確');
    if (role !== undefined && ['admin', 'member'].indexOf(role) < 0) throw new ApiError_('角色不正確');

    var losesAdmin = user.role === 'admin' && user.status === 'active' &&
      ((role !== undefined && role !== 'admin') || (status !== undefined && status !== 'active'));
    if (losesAdmin && activeAdmins_(a).length <= 1) throw new ApiError_('至少要保留一位啟用中的管理員');

    if (status !== undefined && status !== user.status) {
      audit_(a, actor, 'set-status', user, user.status + ' -> ' + status);
      user.status = status;
      if (status !== 'active') dropSessions_(a, user.id, null);
    }
    if (role !== undefined && role !== user.role) {
      audit_(a, actor, 'set-role', user, user.role + ' -> ' + role);
      user.role = role;
    }
    if (request.newPasswordKey !== undefined) {
      setPassword_(user, requireKey_(request.newPasswordKey));
      dropSessions_(a, user.id, null);
      audit_(a, actor, 'reset-password', user, '');
    }
    return toPublic_(user);
  });
}

function adminDeleteUser_(request) {
  mutateAs_(request.session, function (a, actor) {
    requireAdmin_(actor);
    var user = findUser_(a, String(request.userId));
    if (user.id === actor.id) throw new ApiError_('不能刪除自己的帳號');
    if (user.role === 'admin' && user.status === 'active' && activeAdmins_(a).length <= 1) {
      throw new ApiError_('至少要保留一位啟用中的管理員');
    }
    a.users = a.users.filter(function (u) { return u.id !== user.id; });
    dropSessions_(a, user.id, null);
    var removed = trashMemberData_(user);
    audit_(a, actor, 'delete-user', user,
      removed ? 'account and data removed' : 'account removed; data spreadsheet could not be trashed');
  });
}

function adminSetConfig_(request) {
  return mutateAs_(request.session, function (a, actor) {
    requireAdmin_(actor);
    if (request.registration !== undefined) {
      if (request.registration !== 'approval' && request.registration !== 'open') throw new ApiError_('註冊模式不正確');
      if (request.registration !== a.config.registration) {
        audit_(a, actor, 'set-registration', null, request.registration);
        a.config.registration = request.registration;
      }
    }
    if (request.googleClientId !== undefined) {
      var id = String(request.googleClientId).trim();
      if (id && !/^[A-Za-z0-9._-]{10,200}$/.test(id)) throw new ApiError_('Google 用戶端 ID 格式不正確');
      if (id) a.config.googleClientId = id;
      else delete a.config.googleClientId;
      a.clientId = property_('GOOGLE_CLIENT_ID') || a.config.googleClientId;
      audit_(a, actor, 'set-google-client', null, id ? 'set' : 'cleared');
    }
    var config = publicConfig_(a);
    config.hasUsers = true;
    return config;
  });
}

// ---- Member data -----------------------------------------------------------
// Every member's tables live in their own spreadsheet, so members are
// separated at the file level. load/save take the spreadsheet as a parameter.

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet: bind the script to a sheet or set SHEET_ID');
  return ss;
}

/**
 * The member's own spreadsheet. Without `create`, a member who has never
 * saved has none and null is returned. Call under the lock.
 */
function memberSpreadsheet_(user, create) {
  if (user.dataSheetId) return SpreadsheetApp.openById(user.dataSheetId);
  if (!create) return null;
  // Named by id only, so the member's name does not show up in Drive.
  var ss = SpreadsheetApp.create('Exfolio data ' + user.id);
  user.dataSheetId = ss.getId();
  setRevision_(ss, 0);
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  return ss;
}

/** Moves the member's spreadsheet to the deployer's Drive trash. */
function trashMemberData_(user) {
  if (!user.dataSheetId) return true;
  try {
    DriveApp.getFileById(user.dataSheetId).setTrashed(true);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Data from before accounts existed sits in the control spreadsheet's own
 * table sheets. The first member gets a copy, once; the original sheets are
 * left in place (delete them after checking), as the Node backend keeps its
 * old file renamed.
 */
function handOverLegacy_(a, user) {
  if (a.config.legacyHandedOver) return;
  var legacy = readAll_(a.ss);
  var found = legacy.revision > 0 || TABLES.some(function (name) { return legacy.tables[name].length > 0; });
  if (!found) return;
  var ss = memberSpreadsheet_(user, true);
  TABLES.forEach(function (name) {
    if (legacy.tables[name].length) writeTable_(ss, name, legacy.tables[name], []);
  });
  setRevision_(ss, legacy.revision);
  a.config.legacyHandedOver = new Date().toISOString();
}

function getRevision_(ss) {
  var sheet = ss.getSheetByName(META_SHEET);
  return sheet ? Number(sheet.getRange(1, 2).getValue()) || 0 : 0;
}

function setRevision_(ss, revision) {
  var sheet = ss.getSheetByName(META_SHEET) || ss.insertSheet(META_SHEET);
  sheet.getRange(1, 1, 1, 2).setValues([['revision', revision]]);
}

function readAll_(ss) {
  var tables = {};
  TABLES.forEach(function (name) {
    tables[name] = readTable_(ss, name);
  });
  return { revision: getRevision_(ss), tables: tables };
}

/**
 * Whose data a `load` may read. Opening another member's data needs the
 * admin role and that member's standing consent, is read-only, and is logged.
 */
function load_(request) {
  return mutateAs_(request.session, function (a, actor) {
    var owner = actor;
    var asUser = request.asUser;
    if (asUser !== undefined && asUser !== null && asUser !== '' && asUser !== actor.id) {
      requireAdmin_(actor);
      var target = findUser_(a, String(asUser));
      if (!target.allowAdminView) throw new ApiError_('forbidden');
      audit_(a, actor, 'view-data', target, 'read-only');
      owner = target;
    }
    var ss = memberSpreadsheet_(owner, false);
    var data = ss ? readAll_(ss) : { revision: 0, tables: readAllEmpty_() };
    return { ok: true, revision: data.revision, tables: data.tables };
  });
}

function readAllEmpty_() {
  var tables = {};
  TABLES.forEach(function (name) { tables[name] = []; });
  return tables;
}

/** A save always targets the caller's own spreadsheet. */
function save_(request) {
  var tables = request.tables || {};
  var baseRevision = request.baseRevision;
  return mutateAs_(request.session, function (a, actor) {
    var ss = memberSpreadsheet_(actor, false);
    var revision = ss ? getRevision_(ss) : 0;
    if (baseRevision !== undefined && baseRevision !== null && baseRevision !== revision) {
      return { ok: false, error: 'conflict', revision: revision };
    }
    // Check every table before writing any, so a bad row changes nothing.
    TABLES.forEach(function (name) {
      var rows = tables[name];
      if (!Array.isArray(rows)) return;
      rows.forEach(function (row) {
        if (!row || typeof row !== 'object' || row.id === undefined || row.id === '') {
          throw new Error('Every row in "' + name + '" needs an id');
        }
      });
    });
    if (!ss) ss = memberSpreadsheet_(actor, true);
    TABLES.forEach(function (name) {
      if (Array.isArray(tables[name])) writeTable_(ss, name, tables[name], []);
    });
    setRevision_(ss, revision + 1);
    return { ok: true, revision: revision + 1 };
  });
}

/**
 * Each row is stored whole as JSON in the `_json` column: that is the
 * source of truth. The other columns mirror its fields for reading in
 * Sheets and are rewritten on every save, so edits made there are lost.
 */
function readTable_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var column = values[0].indexOf(JSON_COLUMN);
  if (column < 0) throw new Error('Sheet "' + name + '" has no ' + JSON_COLUMN + ' column');
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var cell = values[r][column];
    if (cell === '' || cell === null) continue;
    rows.push(JSON.parse(cell));
  }
  return rows;
}

/** `hidden` lists fields that stay in `_json` and get no mirror column. */
function writeTable_(ss, name, rows, hidden) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var keys = [];
  rows.forEach(function (row) {
    Object.keys(row).forEach(function (key) {
      // A field named like the JSON column would be mistaken for it when read back.
      if (key === JSON_COLUMN) return;
      if (keys.indexOf(key) < 0 && (!hidden || hidden.indexOf(key) < 0)) keys.push(key);
    });
  });
  // Field names come from members' rows too, so the header is escaped like any other cell.
  var header = keys.map(displayValue_).concat([JSON_COLUMN]);
  var values = [header].concat(rows.map(function (row) {
    return keys.map(function (key) { return displayValue_(row[key]); })
      .concat([JSON.stringify(row)]);
  }));
  sheet.clearContents();
  var range = sheet.getRange(1, 1, values.length, header.length);
  // Plain text keeps Sheets from turning "0050" into 50 or "2026-01-02" into a date.
  range.setNumberFormat('@');
  range.setValues(values);
  sheet.setFrozenRows(1);
}

/**
 * Text for a mirror cell. Sheets evaluates a value that starts with = + - or @
 * as a formula even in a plain-text cell, and these values come from members
 * (and, for a display name, from anyone who can reach the sign-up form). A
 * leading apostrophe makes Sheets store the rest as literal text.
 */
function displayValue_(value) {
  if (value === undefined || value === null) return '';
  var text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return FORMULA_LIKE_.test(text) ? "'" + text : text;
}

// = + - @ in ASCII or full width, possibly after spaces, or a leading tab / line break.
var FORMULA_LIKE_ = /^(?:[\t\r\n]|[\s\u3000\ufeff]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/;

// ---- Quotes ----------------------------------------------------------
// Free public endpoints, not licensed market data: prices may be delayed
// and the endpoints may change or rate-limit.

function quoteUrl_(item) {
  var symbol = encodeURIComponent(item.symbol);
  if (item.source === 'yahoo') {
    return 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?interval=1d&range=1d';
  }
  if (item.source === 'binance') {
    // Market-data-only host: api.binance.com refuses requests from some regions.
    return 'https://data-api.binance.vision/api/v3/ticker/price?symbol=' + symbol;
  }
  if (item.source === 'binance_futures') {
    // USDⓈ-M perpetuals, including TradFi contracts such as SPYUSDT.
    return 'https://fapi.binance.com/fapi/v1/ticker/price?symbol=' + symbol;
  }
  return '';
}

function parseQuote_(item, text) {
  var body = JSON.parse(text);
  if (item.source === 'yahoo') {
    var meta = body && body.chart && body.chart.result && body.chart.result[0] && body.chart.result[0].meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('No price in response');
    var seconds = meta.regularMarketTime || Date.now() / 1000;
    return {
      price: meta.regularMarketPrice,
      currency: meta.currency,
      asOf: new Date(seconds * 1000).toISOString(),
      status: 'delayed'
    };
  }
  var price = Number(body && body.price);
  if (!(price > 0)) throw new Error('No price in response');
  return { price: price, asOf: new Date().toISOString(), status: 'realtime' };
}

/** TAIFEX quote: product code (nearest monthly contract) or full contract id. */
function taifexQuote_(symbol) {
  var exact = symbol.indexOf('-') >= 0;
  var cid = exact ? symbol.slice(0, 3) : symbol;
  var monthly = new RegExp('^' + cid + '[A-L]\\d-[FM]$');
  // Contract ids end in -F in the regular session and -M after hours.
  var contract = exact ? symbol.replace(/-[FM]$/, '') : '';
  var best = null;
  ['0', '1'].forEach(function (marketType) {
    var response = UrlFetchApp.fetch('https://mis.taifex.com.tw/futures/api/getQuoteList', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        MarketType: marketType, SymbolType: 'F', KindID: '1', CID: cid,
        ExpireMonth: '', RowSize: '全部', PageNo: '', SortColumn: '', AscDesc: 'A'
      })
    });
    if (response.getResponseCode() !== 200) throw new Error('HTTP ' + response.getResponseCode());
    var body = JSON.parse(response.getContentText());
    var list = (body && body.RtData && body.RtData.QuoteList) || [];
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (exact ? String(q.SymbolID).replace(/-[FM]$/, '') !== contract : !monthly.test(q.SymbolID)) continue;
      var price = Number(q.CLastPrice);
      var d = String(q.CDate || '');
      if (!(price > 0) || !/^\d{8}$/.test(d)) break;
      var t = ('000000' + String(q.CTime || '')).slice(-6);
      var at = new Date(d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6) + 'T' +
        t.slice(0, 2) + ':' + t.slice(2, 4) + ':' + t.slice(4, 6) + '+08:00').getTime();
      // After-hours trades past midnight still carry the previous calendar date.
      if (marketType === '1' && Number(t.slice(0, 2)) < 15) at += 86400000;
      if (!best || at > best.at) best = { price: price, at: at };
      break;
    }
  });
  if (!best) throw new Error('No price in response');
  return { price: best.price, currency: 'TWD', asOf: new Date(best.at).toISOString(), status: 'delayed' };
}

function fetchQuotes_(items) {
  var cache = CacheService.getScriptCache();
  var results = [];
  var pending = [];
  items.slice(0, 200).forEach(function (item, index) {
    var result = { source: item.source, symbol: item.symbol };
    results.push(result);
    if (item.source === 'taifex') {
      var hit = cache.get('q:taifex:' + item.symbol);
      if (hit) {
        results[index] = JSON.parse(hit);
        return;
      }
      try {
        var quote = taifexQuote_(item.symbol);
        Object.keys(quote).forEach(function (key) { result[key] = quote[key]; });
        cache.put('q:taifex:' + item.symbol, JSON.stringify(result), QUOTE_TTL_SECONDS);
      } catch (err) {
        result.error = String((err && err.message) || err);
      }
      return;
    }
    var url = quoteUrl_(item);
    if (!url) {
      result.error = 'Manual source has no remote quote';
      return;
    }
    var cached = cache.get('q:' + item.source + ':' + item.symbol);
    if (cached) {
      results[index] = JSON.parse(cached);
      return;
    }
    pending.push({ index: index, item: item, url: url });
  });
  if (!pending.length) return results;

  var responses = UrlFetchApp.fetchAll(pending.map(function (p) {
    return {
      url: p.url,
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (exfolio quote proxy)', Accept: 'application/json' }
    };
  }));
  responses.forEach(function (response, i) {
    var p = pending[i];
    var result = results[p.index];
    try {
      var code = response.getResponseCode();
      if (code !== 200) throw new Error('HTTP ' + code);
      var quote = parseQuote_(p.item, response.getContentText());
      Object.keys(quote).forEach(function (key) { result[key] = quote[key]; });
      cache.put('q:' + p.item.source + ':' + p.item.symbol, JSON.stringify(result), QUOTE_TTL_SECONDS);
    } catch (err) {
      result.error = String((err && err.message) || err);
    }
  });
  return results;
}

function isoDay_(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Daily closes from `from` (YYYY-MM-DD) to today, per item. */
function fetchHistory_(items, from) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) throw new Error('`from` must be YYYY-MM-DD');
  var startMs = new Date(from + 'T00:00:00Z').getTime();
  return items.slice(0, 50).map(function (item) {
    var result = { source: item.source, symbol: item.symbol, points: [] };
    try {
      var symbol = encodeURIComponent(item.symbol);
      if (item.source === 'yahoo') {
        var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?interval=1d&period1=' +
          Math.floor(startMs / 1000) + '&period2=' + Math.floor(Date.now() / 1000);
        var chart = fetchJson_(url).chart.result[0];
        var stamps = chart.timestamp || [];
        var closes = chart.indicators.quote[0].close || [];
        var adjusted = (chart.indicators.adjclose && chart.indicators.adjclose[0].adjclose) || [];
        var offset = ((chart.meta && chart.meta.gmtoffset) || 0) * 1000;
        stamps.forEach(function (t, i) {
          if (typeof closes[i] !== 'number') return;
          var point = { date: isoDay_(t * 1000 + offset), close: closes[i] };
          if (typeof adjusted[i] === 'number') point.adjClose = adjusted[i];
          result.points.push(point);
        });
      } else if (item.source === 'binance') {
        var start = startMs;
        for (var page = 0; page < 10; page++) {
          var rows = fetchJson_('https://data-api.binance.vision/api/v3/klines?symbol=' + symbol +
            '&interval=1d&startTime=' + start + '&limit=1000');
          if (!rows.length) break;
          rows.forEach(function (row) {
            result.points.push({ date: isoDay_(Number(row[0])), close: Number(row[4]) });
          });
          if (rows.length < 1000) break;
          start = Number(rows[rows.length - 1][0]) + 86400000;
        }
      } else {
        result.error = 'Manual source has no remote history';
      }
    } catch (err) {
      result.error = String((err && err.message) || err);
    }
    return result;
  });
}

function fetchJson_(url) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (exfolio quote proxy)', Accept: 'application/json' }
  });
  if (response.getResponseCode() !== 200) throw new Error('HTTP ' + response.getResponseCode());
  return JSON.parse(response.getContentText());
}

// ---- Setup helper (run once from the Apps Script editor) -------------------

/**
 * Creates the control sheets so the layout is visible, and is the easiest
 * way to trigger the authorization prompt for all the scopes in
 * appsscript.json. Member spreadsheets are created later, on first save.
 */
function setupSheets() {
  locked_(function () {
    var a = loadAuth_();
    [[USERS_SHEET, USER_HIDDEN], [SESSIONS_SHEET, SESSION_HIDDEN], [AUDIT_SHEET, []]].forEach(function (s) {
      if (!a.ss.getSheetByName(s[0])) writeTable_(a.ss, s[0], [], s[1]);
    });
    if (!a.ss.getSheetByName(CONFIG_SHEET)) writeTable_(a.ss, CONFIG_SHEET, [a.config], []);
  });
}
