// The only form of members' backend address the public edition accepts: an
// Apps Script web app. Shared by the app and the build's security policy.

const GAS_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;

/** The trimmed address when it is an Apps Script web app, otherwise ''. */
export function gasExecUrl(raw: unknown): string {
  const url = String(raw ?? '').trim();
  return GAS_URL.test(url) ? url : '';
}
