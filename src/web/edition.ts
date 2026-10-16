// Which edition of the site this build is.
//
// 'full'   — everything, for running with a backend: members, sync, every page.
// 'public' — the static site for GitHub Pages, focused on the current
//            allocation, risk and new-money planning. Visitors who are not
//            signed in use it as a calculator: what they enter lives only in
//            the open tab. Members sign in with Google and their data is
//            kept by the shared Apps Script backend named at build time.

import { gasExecUrl } from './gasUrl';

export type Edition = 'full' | 'public';

export const EDITION: Edition =
  import.meta.env.VITE_EXFOLIO_EDITION === 'public' ? 'public' : 'full';

export const IS_PUBLIC = EDITION === 'public';

/**
 * Public edition: the members' backend, or '' when this build has none.
 * Only an Apps Script web app address is accepted, so a mistyped variable
 * can never send members' data anywhere else.
 */
export const PUBLIC_GAS_URL: string = IS_PUBLIC
  ? gasExecUrl(import.meta.env.VITE_EXFOLIO_GAS_URL)
  : '';

/** Whether this build offers sign-in at all. */
export const MEMBERS_ENABLED = !IS_PUBLIC || PUBLIC_GAS_URL !== '';
