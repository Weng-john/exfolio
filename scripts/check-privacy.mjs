#!/usr/bin/env node
// Refuses to let personal data or secrets into the repository.
//
//   (default)   every tracked file at HEAD
//   --staged    files staged for commit (the pre-commit hook)
//   --history   every file in every commit, plus commit identities (CI)
//
// This is a safety net, not a boundary: `git commit --no-verify`, a fresh
// clone that never ran `npm install`, or data it has no rule for all get
// past it. What must stay private belongs in the git-ignored folders.

import { execFileSync } from 'node:child_process';

const staged = process.argv.includes('--staged');
const history = process.argv.includes('--history');
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const gitBytes = (...args) => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });
const lines = (text) => text.split('\n').filter(Boolean);

// Paths that hold personal data or credentials by definition.
const FORBIDDEN_PATHS = [
  [/^(data|backups|exports|imports|statements|private)\//, '個人資料目錄'],
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, '環境變數檔'],
  [/(^|\/)\.clasp(rc)?\.json$/, 'clasp 帳號連結檔'],
  [/\.(pem|key|p12|pfx|jks|keystore)$/i, '金鑰檔'],
  [/(^|\/)(credentials|service-account|token|client_secret)[^/]*\.json$/i, '憑證檔'],
  [/backup[^/]*\.json$/i, '資料備份檔'],
  [/\.(xlsx|xls|ods|pdf|ofx|qfx|qif|zip|7z|rar|tar|gz|tgz)$/i, '對帳單、試算表或壓縮檔'],
  [/\.(sqlite|sqlite3|db|bundle)$/i, '資料庫或版本庫封存檔'],
];
// Statements arrive as tables or pictures: only fictional fixtures may be tracked.
const DATA_LIKE = /\.(csv|tsv|png|jpe?g|webp|bmp|gif|heic|tiff?)$/i;
const ALLOWED_DATA = /^tests\/fixtures\//;
const TEXT =
  /\.(ts|tsx|mts|mjs|js|json|md|css|html|gs|yml|yaml|csv|tsv|txt|svg|example)$|(^|\/)\.[a-z]+(rc|ignore)(\.json)?$|^\.githooks\//i;

// Content that should never appear in tracked text.
const CONTENT_RULES = [
  [/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/, 'GAS 部署網址'],
  [/https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/, 'Google Sheets 網址'],
  [/\b\d{9,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com\b/, 'OAuth 用戶端 ID'],
  [/\bGOCSPX-[A-Za-z0-9_-]{10,}/, 'OAuth client secret'],
  [/\b[A-Z][12]\d{8}\b/, '疑似身分證字號'],
  [/(^|[^\d])09\d{2}[- ]?\d{3}[- ]?\d{3}([^\d]|$)/, '疑似手機號碼'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私鑰'],
  [
    /\b((AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{24,})\b/,
    '雲端服務金鑰',
  ],
  [
    // Also the quoted-name form used in JSON: "api_key": "...".
    /\b(api[_-]?key|api[_-]?secret|secret[_-]?key|client[_-]?secret|access[_-]?token|password)\b["']?\s*[:=]\s*['"][A-Za-z0-9+/_=.-]{16,}['"]/i,
    '疑似寫死的金鑰',
  ],
  [/\b[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|icloud)\.[a-z.]+\b/i, '個人電子郵件'],
  [/\/(home|Users)\/[a-z][a-z0-9_.-]+\//, '本機家目錄路徑'],
];
const SKIP_CONTENT = /^(package-lock\.json|scripts\/check-privacy\.mjs)$/;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const findings = new Set();

function checkPath(file, where) {
  for (const [pattern, label] of FORBIDDEN_PATHS) {
    if (pattern.test(file)) findings.add(`${where}${file}: ${label}`);
  }
  if (DATA_LIKE.test(file) && !ALLOWED_DATA.test(file)) {
    findings.add(`${where}${file}: 表格與圖片只允許放在 tests/fixtures/（虛構資料）`);
  }
  if (!TEXT.test(file) && !DATA_LIKE.test(file) && !/\.(woff2?|ttf|ico)$/i.test(file)) {
    findings.add(`${where}${file}: 未列入允許清單的檔案類型`);
  }
}

/** Text of a blob, whether UTF-8 or UTF-16 (statements are often the latter). */
function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

function checkContent(file, bytes, where) {
  if (SKIP_CONTENT.test(file) || !TEXT.test(file)) return;
  if (bytes.length > MAX_TEXT_BYTES) {
    findings.add(`${where}${file}: 文字檔超過 ${MAX_TEXT_BYTES / 1024 / 1024} MB，無法檢查`);
    return;
  }
  decode(bytes)
    .split('\n')
    .forEach((line, i) => {
      for (const [pattern, label] of CONTENT_RULES) {
        if (pattern.test(line)) findings.add(`${where}${file}:${i + 1}: ${label}`);
      }
    });
}

const PERSONAL_EMAIL = /@(gmail|yahoo|hotmail|outlook|icloud)\./i;
let scanned = 0;

if (history) {
  // Every path a file has ever had, so one moved out of a forbidden place still counts.
  for (const file of new Set(lines(git('log', '--all', '--name-only', '--format=')))) {
    checkPath(file, '[歷史路徑] ');
  }
  // Every blob ever committed: deleting a file later does not unpublish it.
  const seen = new Set();
  for (const line of lines(git('rev-list', '--all', '--objects'))) {
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const sha = line.slice(0, space);
    const file = line.slice(space + 1);
    if (!file || seen.has(`${sha} ${file}`)) continue;
    seen.add(`${sha} ${file}`);
    if (git('cat-file', '-t', sha).trim() !== 'blob') continue;
    scanned += 1;
    const where = `[${sha.slice(0, 7)}] `;
    checkPath(file, where);
    checkContent(file, gitBytes('cat-file', 'blob', sha), where);
  }
  for (const email of new Set(lines(git('log', '--all', '--format=%ae%n%ce')))) {
    if (PERSONAL_EMAIL.test(email))
      findings.add('提交紀錄含個人信箱：推送前需改寫歷史（見 docs/PRIVACY.md）');
  }
  for (const line of lines(git('log', '--all', '--format=%B'))) {
    for (const [pattern, label] of CONTENT_RULES) {
      if (pattern.test(line)) findings.add(`提交訊息: ${label}`);
    }
  }
} else {
  const files = lines(
    staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR') : git('ls-files'),
  );
  for (const file of files) {
    scanned += 1;
    checkPath(file, '');
    // Read what is staged or committed, not whatever is in the working tree.
    let bytes;
    try {
      bytes = gitBytes('show', staged ? `:${file}` : `HEAD:${file}`);
    } catch {
      continue;
    }
    checkContent(file, bytes, '');
  }
  const emails = staged
    ? [git('config', 'user.email').trim()]
    : [...new Set(lines(git('log', '--all', '--format=%ae%n%ce')))];
  for (const email of emails) {
    if (PERSONAL_EMAIL.test(email)) {
      findings.add(
        staged
          ? 'git user.email 是個人信箱：請改用 GitHub noreply 信箱（見 docs/PRIVACY.md）'
          : '提交紀錄含個人信箱：推送前需改寫歷史（見 docs/PRIVACY.md）',
      );
    }
  }
}

if (findings.size) {
  console.error('隱私檢查未通過，以下內容不應進入版本庫：\n');
  for (const f of findings) console.error(`  ${f}`);
  console.error('\n說明見 docs/PRIVACY.md。');
  process.exit(1);
}
console.log(`隱私檢查通過（${scanned} 個${history ? '歷史版本' : '檔案'}）。`);
