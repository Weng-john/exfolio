import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type {
  ApiErrorCode,
  AuditEntry,
  PublicUser,
  RegistrationMode,
  ServerConfig,
  UserRole,
  UserStatus,
} from '../src/core/api';
import { dataDir, localDataFile, readJson, serialize, userDataFile, writeJson } from './store';

// Members, sessions and admin actions for the local backend. Everything is
// kept in one owner-readable JSON file beside the per-member data files.

const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_AUDIT = 1000;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode | (string & {})) {
    super(code);
  }
}

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  allowAdminView: boolean;
  /** scrypt of the client-derived password key, with a per-user salt. */
  passwordSalt?: string;
  passwordHash?: string;
  /** Google's stable account identifier. */
  googleSub?: string;
  createdAt: string;
  lastLoginAt?: string;
}

interface SessionRecord {
  /** SHA-256 of the token: a leaked file does not yield usable sessions. */
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

interface AuthFile {
  users: UserRecord[];
  sessions: SessionRecord[];
  config: { registration: RegistrationMode; googleClientId?: string };
  audit: AuditEntry[];
}

/** Single-user mode with no login, for a private machine. */
export function authOff(): boolean {
  return process.env.EXFOLIO_AUTH === 'off';
}

const authFile = () => path.join(dataDir(), 'auth.json');

async function read(): Promise<AuthFile> {
  const file = await readJson<Partial<AuthFile>>(authFile(), {});
  return {
    users: file.users ?? [],
    sessions: file.sessions ?? [],
    config: file.config ?? { registration: 'approval' },
    audit: file.audit ?? [],
  };
}

/** Read, change and write the auth file as one serialized step. */
function mutate<T>(change: (file: AuthFile) => Promise<T> | T): Promise<T> {
  return serialize(async () => {
    const file = await read();
    const result = await change(file);
    const now = Date.now();
    file.sessions = file.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
    file.audit = file.audit.slice(-MAX_AUDIT);
    await writeJson(authFile(), file);
    return result;
  });
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;

function hashKey(passwordKey: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(passwordKey, Buffer.from(salt, 'hex'), 32, SCRYPT, (err, key) =>
      err ? reject(err) : resolve(key.toString('hex')),
    );
  });
}

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function normalizeUsername(raw: unknown): string {
  const username = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9._@+-]{3,64}$/.test(username)) {
    throw new ApiError('帳號需為 3–64 個字元，只能使用英數字與 . _ @ + -');
  }
  return username;
}

function requireKey(raw: unknown): string {
  const key = String(raw ?? '');
  if (!/^[0-9a-f]{64}$/.test(key)) throw new ApiError('密碼格式不正確');
  return key;
}

function cleanName(raw: unknown, fallback: string): string {
  const name = String(raw ?? '')
    .trim()
    .slice(0, 80);
  return name || fallback;
}

export function toPublic(u: UserRecord): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    allowAdminView: u.allowAdminView,
    hasPassword: Boolean(u.passwordHash),
    googleLinked: Boolean(u.googleSub),
    createdAt: u.createdAt,
    ...(u.lastLoginAt ? { lastLoginAt: u.lastLoginAt } : {}),
  };
}

function audit(
  file: AuthFile,
  actor: UserRecord,
  action: string,
  target?: UserRecord,
  detail?: string,
) {
  file.audit.push({
    id: newId('audit'),
    at: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.username,
    action,
    ...(target ? { targetId: target.id, targetName: target.username } : {}),
    ...(detail ? { detail } : {}),
  });
}

function openSession(file: AuthFile, user: UserRecord): string {
  const token = randomBytes(32).toString('base64url');
  file.sessions.push({
    tokenHash: sha256(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
  });
  user.lastLoginAt = new Date().toISOString();
  return token;
}

/** Create a member. The first one becomes an active admin. */
async function createUser(
  file: AuthFile,
  fields: Partial<UserRecord> & { username: string },
): Promise<UserRecord> {
  const first = file.users.length === 0;
  const user: UserRecord = {
    id: newId('u'),
    displayName: fields.username,
    role: first ? 'admin' : 'member',
    status: first || file.config.registration === 'open' ? 'active' : 'pending',
    // On while the product is in testing; each member can turn it off.
    allowAdminView: true,
    createdAt: new Date().toISOString(),
    ...fields,
  };
  file.users.push(user);
  audit(file, user, 'register', undefined, first ? 'first account: admin' : user.status);
  // A single-user data file from before accounts existed goes to the first member.
  if (first && existsSync(localDataFile()) && !existsSync(userDataFile(user.id))) {
    await writeJson(userDataFile(user.id), await readJson(localDataFile(), {}));
    await rename(localDataFile(), `${localDataFile()}.migrated`);
  }
  return user;
}

// ---- Login throttling ------------------------------------------------------

const failures = new Map<string, { count: number; since: number }>();

function checkThrottle(key: string) {
  const f = failures.get(key);
  if (!f) return;
  if (Date.now() - f.since > FAILURE_WINDOW_MS) failures.delete(key);
  else if (f.count >= MAX_FAILURES) throw new ApiError('rate_limited');
}

function recordFailure(key: string) {
  const f = failures.get(key);
  if (!f || Date.now() - f.since > FAILURE_WINDOW_MS)
    failures.set(key, { count: 1, since: Date.now() });
  else f.count += 1;
}

// ---- Google sign-in --------------------------------------------------------

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
}

export type GoogleVerifier = (idToken: string, clientId: string) => Promise<GoogleIdentity>;

/** Ask Google to validate the token, then check it was issued for this app. */
const verifyWithGoogle: GoogleVerifier = async (idToken, clientId) => {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new ApiError('invalid_credentials');
  const info = (await res.json()) as Record<string, string>;
  const issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  const fresh = Number(info.exp) * 1000 > Date.now();
  if (
    info.aud !== clientId ||
    !issuerOk ||
    !fresh ||
    String(info.email_verified) !== 'true' ||
    !info.sub
  ) {
    throw new ApiError('invalid_credentials');
  }
  return { sub: info.sub, email: info.email, name: info.name };
};

let googleVerifier = verifyWithGoogle;

/** Tests substitute the network call. */
export function setGoogleVerifier(verifier?: GoogleVerifier) {
  googleVerifier = verifier ?? verifyWithGoogle;
}

async function googleIdentity(file: AuthFile, idToken: unknown): Promise<GoogleIdentity> {
  const clientId = file.config.googleClientId;
  if (!clientId) throw new ApiError('尚未啟用 Google 登入');
  if (typeof idToken !== 'string' || !idToken) throw new ApiError('invalid_credentials');
  try {
    return await googleVerifier(idToken, clientId);
  } catch {
    // Whatever went wrong, the caller learns only that sign-in failed.
    throw new ApiError('invalid_credentials');
  }
}

// ---- Public operations -----------------------------------------------------

export async function getConfig(): Promise<ServerConfig> {
  if (authOff()) return { authRequired: false, registration: 'approval', hasUsers: true };
  const file = await read();
  return {
    authRequired: true,
    registration: file.config.registration,
    ...(file.config.googleClientId ? { googleClientId: file.config.googleClientId } : {}),
    hasUsers: file.users.length > 0,
  };
}

export interface LoginResult {
  user: PublicUser;
  /** Absent when the account still awaits approval. */
  session?: string;
}

export function register(input: {
  username: unknown;
  displayName?: unknown;
  passwordKey: unknown;
}): Promise<LoginResult> {
  const username = normalizeUsername(input.username);
  const key = requireKey(input.passwordKey);
  return mutate(async (file) => {
    if (file.users.some((u) => u.username === username)) throw new ApiError('username_taken');
    const passwordSalt = randomBytes(16).toString('hex');
    const user = await createUser(file, {
      username,
      displayName: cleanName(input.displayName, username),
      passwordSalt,
      passwordHash: await hashKey(key, passwordSalt),
    });
    return {
      user: toPublic(user),
      ...(user.status === 'active' ? { session: openSession(file, user) } : {}),
    };
  });
}

function requireActive(user: UserRecord) {
  if (user.status === 'pending') throw new ApiError('pending');
  if (user.status === 'disabled') throw new ApiError('disabled');
}

export function login(input: { username: unknown; passwordKey: unknown }): Promise<LoginResult> {
  const username = String(input.username ?? '')
    .trim()
    .toLowerCase();
  const key = requireKey(input.passwordKey);
  checkThrottle(username);
  return mutate(async (file) => {
    const user = file.users.find((u) => u.username === username);
    // Hash even for an unknown account, so timing does not reveal which exist.
    const salt = user?.passwordSalt ?? '00'.repeat(16);
    const hash = await hashKey(key, salt);
    if (!user?.passwordHash || !equalHex(hash, user.passwordHash)) {
      recordFailure(username);
      throw new ApiError('invalid_credentials');
    }
    requireActive(user);
    failures.delete(username);
    return { user: toPublic(user), session: openSession(file, user) };
  });
}

export function loginGoogle(input: { idToken: unknown }): Promise<LoginResult> {
  return mutate(async (file) => {
    const identity = await googleIdentity(file, input.idToken);
    let user = file.users.find((u) => u.googleSub === identity.sub);
    if (!user) {
      // Never attach to an existing account by matching names: whoever chose
      // that username first has not proven they own the Google address.
      let username = normalizeUsername(identity.email);
      while (file.users.some((u) => u.username === username)) {
        username = `${username.slice(0, 56)}+${randomBytes(3).toString('hex')}`;
      }
      user = await createUser(file, {
        username,
        displayName: cleanName(identity.name, identity.email),
        googleSub: identity.sub,
      });
    }
    if (user.status !== 'active') return { user: toPublic(user) };
    return { user: toPublic(user), session: openSession(file, user) };
  });
}

/** The active member behind a session token, or an error. */
export async function authenticate(session: unknown): Promise<UserRecord> {
  if (typeof session !== 'string' || !session) throw new ApiError('unauthenticated');
  const file = await read();
  const tokenHash = sha256(session);
  const record = file.sessions.find((s) => s.tokenHash === tokenHash);
  if (!record || new Date(record.expiresAt).getTime() <= Date.now())
    throw new ApiError('unauthenticated');
  const user = file.users.find((u) => u.id === record.userId);
  if (!user) throw new ApiError('unauthenticated');
  requireActive(user);
  return user;
}

export function logout(session: unknown): Promise<void> {
  const tokenHash = sha256(String(session ?? ''));
  return mutate((file) => {
    file.sessions = file.sessions.filter((s) => s.tokenHash !== tokenHash);
  });
}

function find(file: AuthFile, userId: string): UserRecord {
  const user = file.users.find((u) => u.id === userId);
  if (!user) throw new ApiError('找不到這個帳號');
  return user;
}

export function updateProfile(
  actor: UserRecord,
  input: { displayName?: unknown; allowAdminView?: unknown },
): Promise<PublicUser> {
  return mutate((file) => {
    const user = find(file, actor.id);
    if (input.displayName !== undefined)
      user.displayName = cleanName(input.displayName, user.username);
    if (typeof input.allowAdminView === 'boolean' && input.allowAdminView !== user.allowAdminView) {
      user.allowAdminView = input.allowAdminView;
      audit(file, user, 'set-admin-view', undefined, input.allowAdminView ? 'allowed' : 'refused');
    }
    return toPublic(user);
  });
}

export function changePassword(
  actor: UserRecord,
  input: { oldPasswordKey?: unknown; newPasswordKey: unknown },
  currentSession: unknown,
): Promise<PublicUser> {
  const next = requireKey(input.newPasswordKey);
  return mutate(async (file) => {
    const user = find(file, actor.id);
    if (user.passwordHash) {
      const old = requireKey(input.oldPasswordKey);
      if (!equalHex(await hashKey(old, user.passwordSalt!), user.passwordHash)) {
        throw new ApiError('invalid_credentials');
      }
    }
    user.passwordSalt = randomBytes(16).toString('hex');
    user.passwordHash = await hashKey(next, user.passwordSalt);
    // Sign out every other device.
    const keep = sha256(String(currentSession ?? ''));
    file.sessions = file.sessions.filter((s) => s.userId !== user.id || s.tokenHash === keep);
    audit(file, user, 'change-password');
    return toPublic(user);
  });
}

export function linkGoogle(actor: UserRecord, input: { idToken: unknown }): Promise<PublicUser> {
  return mutate(async (file) => {
    const identity = await googleIdentity(file, input.idToken);
    if (file.users.some((u) => u.googleSub === identity.sub && u.id !== actor.id)) {
      throw new ApiError('這個 Google 帳號已綁定其他會員');
    }
    const user = find(file, actor.id);
    user.googleSub = identity.sub;
    audit(file, user, 'link-google');
    return toPublic(user);
  });
}

// ---- Admin operations ------------------------------------------------------

export function requireAdmin(actor: UserRecord) {
  if (actor.role !== 'admin') throw new ApiError('forbidden');
}

const activeAdmins = (file: AuthFile) =>
  file.users.filter((u) => u.role === 'admin' && u.status === 'active');

export async function listUsers(actor: UserRecord): Promise<PublicUser[]> {
  requireAdmin(actor);
  return (await read()).users.map(toPublic);
}

export function adminUpdateUser(
  actor: UserRecord,
  input: { userId: unknown; status?: unknown; role?: unknown; newPasswordKey?: unknown },
): Promise<PublicUser> {
  requireAdmin(actor);
  return mutate(async (file) => {
    const user = find(file, String(input.userId));
    const status = input.status as UserStatus | undefined;
    const role = input.role as UserRole | undefined;
    if (status !== undefined && !['pending', 'active', 'disabled'].includes(status))
      throw new ApiError('狀態不正確');
    if (role !== undefined && !['admin', 'member'].includes(role)) throw new ApiError('角色不正確');

    const losesAdmin =
      user.role === 'admin' &&
      user.status === 'active' &&
      ((role !== undefined && role !== 'admin') || (status !== undefined && status !== 'active'));
    if (losesAdmin && activeAdmins(file).length <= 1)
      throw new ApiError('至少要保留一位啟用中的管理員');

    if (status !== undefined && status !== user.status) {
      audit(file, actor, 'set-status', user, `${user.status} -> ${status}`);
      user.status = status;
      if (status !== 'active') file.sessions = file.sessions.filter((s) => s.userId !== user.id);
    }
    if (role !== undefined && role !== user.role) {
      audit(file, actor, 'set-role', user, `${user.role} -> ${role}`);
      user.role = role;
    }
    if (input.newPasswordKey !== undefined) {
      user.passwordSalt = randomBytes(16).toString('hex');
      user.passwordHash = await hashKey(requireKey(input.newPasswordKey), user.passwordSalt);
      file.sessions = file.sessions.filter((s) => s.userId !== user.id);
      audit(file, actor, 'reset-password', user);
    }
    return toPublic(user);
  });
}

export function adminDeleteUser(actor: UserRecord, input: { userId: unknown }): Promise<void> {
  requireAdmin(actor);
  return mutate(async (file) => {
    const user = find(file, String(input.userId));
    if (user.id === actor.id) throw new ApiError('不能刪除自己的帳號');
    if (user.role === 'admin' && user.status === 'active' && activeAdmins(file).length <= 1) {
      throw new ApiError('至少要保留一位啟用中的管理員');
    }
    file.users = file.users.filter((u) => u.id !== user.id);
    file.sessions = file.sessions.filter((s) => s.userId !== user.id);
    await rm(userDataFile(user.id), { force: true });
    audit(file, actor, 'delete-user', user, 'account and data removed');
  });
}

export function adminSetConfig(
  actor: UserRecord,
  input: { registration?: unknown; googleClientId?: unknown },
): Promise<ServerConfig> {
  requireAdmin(actor);
  return mutate((file) => {
    if (input.registration !== undefined) {
      if (input.registration !== 'approval' && input.registration !== 'open')
        throw new ApiError('註冊模式不正確');
      if (input.registration !== file.config.registration) {
        audit(file, actor, 'set-registration', undefined, input.registration);
        file.config.registration = input.registration;
      }
    }
    if (input.googleClientId !== undefined) {
      const id = String(input.googleClientId).trim();
      if (id && !/^[A-Za-z0-9._-]{10,200}$/.test(id))
        throw new ApiError('Google 用戶端 ID 格式不正確');
      if (id) file.config.googleClientId = id;
      else delete file.config.googleClientId;
      audit(file, actor, 'set-google-client', undefined, id ? 'set' : 'cleared');
    }
    return {
      authRequired: true,
      registration: file.config.registration,
      ...(file.config.googleClientId ? { googleClientId: file.config.googleClientId } : {}),
      hasUsers: true,
    };
  });
}

export async function listAudit(actor: UserRecord): Promise<AuditEntry[]> {
  requireAdmin(actor);
  return (await read()).audit.slice().reverse();
}

/**
 * Whose data file a `load` may read. Opening another member's data needs
 * the admin role and that member's standing consent, and is always logged.
 */
export async function resolveReadTarget(actor: UserRecord, asUser: unknown): Promise<string> {
  if (asUser === undefined || asUser === null || asUser === '' || asUser === actor.id)
    return actor.id;
  requireAdmin(actor);
  return mutate((file) => {
    const target = find(file, String(asUser));
    if (!target.allowAdminView) throw new ApiError('forbidden');
    audit(file, actor, 'view-data', target, 'read-only');
    return target.id;
  });
}
