// Which edition of the site this build is.
//
// 'full'   — everything, for running with a backend: members, sync, every page.
// 'public' — the static site for GitHub Pages: no backend and no accounts,
//            focused on the current allocation, risk and new-money planning.
//            Data stays in the visitor's own browser.
//
// The member system and the other pages stay in the codebase; the public
// edition simply does not offer them.

export type Edition = 'full' | 'public';

export const EDITION: Edition =
  import.meta.env.VITE_EXFOLIO_EDITION === 'public' ? 'public' : 'full';

export const IS_PUBLIC = EDITION === 'public';
