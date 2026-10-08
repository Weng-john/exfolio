#!/usr/bin/env node
// Refuses to let personal data or secrets into the repository.
// Scans staged files (--staged, used by the pre-commit hook) or every
// tracked file (default). Exits 1 and lists each finding.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const staged = process.argv.includes('--staged');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const files = (staged
  ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR')
  : git('ls-files')
)
  .split('\n')
  .filter(Boolean);

// Paths that hold personal data or credentials by definition.
const FORBIDDEN_PATHS = [
  [/^(data|backups|exports|imports|statements|private)\//, '個人資料目錄'],
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, '環境變數檔'],
  [/(^|\/)\.clasp(rc)?\.json$/, 'clasp 帳號連結檔'],
  [/\.(pem|key|p12)$/, '金鑰檔'],
  [/(^|\/)(credentials|service-account|token)[^/]*\.json$/, '憑證檔'],
  [/backup[^/]*\.json$/i, '資料備份檔'],
  [/\.(xlsx|xls|pdf)$/i, '對帳單或試算表'],
];
const ALLOWED_CSV = /^tests\/fixtures\//;

// Content that should never appear in tracked text.
const CONTENT_RULES = [
  [/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/, 'GAS 部署網址'],
  [/https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/, 'Google Sheets 網址'],
  [/\b[A-Z][12]\d{8}\b/, '疑似身分證字號'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私鑰'],
  [/\b(api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|password)\b\s*[:=]\s*['"][A-Za-z0-9+/_=-]{16,}['"]/i, '疑似寫死的金鑰'],
  [/\b[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|icloud)\.[a-z.]+\b/i, '個人電子郵件'],
];
const SKIP_CONTENT = /^(package-lock\.json|scripts\/check-privacy\.mjs)$/;
const BINARY = /\.(png|jpg|jpeg|gif|ico|woff2?|ttf)$/i;

const findings = [];
for (const file of files) {
  for (const [pattern, label] of FORBIDDEN_PATHS) {
    if (pattern.test(file)) findings.push(`${file}: ${label}`);
  }
  if (/\.csv$/i.test(file) && !ALLOWED_CSV.test(file)) {
    findings.push(`${file}: CSV 只允許放在 tests/fixtures/（虛構資料）`);
  }
  if (SKIP_CONTENT.test(file) || BINARY.test(file) || !existsSync(file)) continue;
  if (statSync(file).size > 2 * 1024 * 1024) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [pattern, label] of CONTENT_RULES) {
      if (pattern.test(line)) findings.push(`${file}:${i + 1}: ${label}`);
    }
  });
}

if (findings.length) {
  console.error('隱私檢查未通過，以下內容不應進入版本庫：\n');
  for (const f of findings) console.error(`  ${f}`);
  console.error('\n說明見 docs/PRIVACY.md。');
  process.exit(1);
}
console.log(`隱私檢查通過（${files.length} 個檔案）。`);
