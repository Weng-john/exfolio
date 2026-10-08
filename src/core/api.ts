import type { AppData, Currency, QuoteSource, QuoteStatus } from './types';

// Wire protocol shared by the local Node backend and the Google Apps Script
// backend. Every call is a POST of one JSON object with an `action`.

export interface QuoteRequestItem {
  source: QuoteSource;
  symbol: string;
}

export interface QuoteResult extends QuoteRequestItem {
  price?: number;
  currency?: Currency;
  /** ISO time of the quote as reported by the source. */
  asOf?: string;
  status?: QuoteStatus;
  error?: string;
}

export interface HistoryPointResult {
  /** YYYY-MM-DD in the exchange's local calendar. */
  date: string;
  close: number;
  adjClose?: number;
}

export interface HistoryResult extends QuoteRequestItem {
  points: HistoryPointResult[];
  error?: string;
}

// ---- Members ---------------------------------------------------------

export type UserRole = 'admin' | 'member';
export type UserStatus = 'pending' | 'active' | 'disabled';
/** 'approval': an admin must activate each new account. 'open': active at once. */
export type RegistrationMode = 'approval' | 'open';

/** What the backend tells a client about a member. Never includes secrets. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  /** The member's own choice: may admins open their portfolio read-only? */
  allowAdminView: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface ServerConfig {
  /** False for a single-user backend that needs no login. */
  authRequired: boolean;
  registration: RegistrationMode;
  /** OAuth client id for Google sign-in. Absent = Google sign-in is off. */
  googleClientId?: string;
  /** False until the first account exists: that account becomes the admin. */
  hasUsers: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  targetId?: string;
  targetName?: string;
  detail?: string;
}

/** Machine-readable failures the client reacts to. Other errors are free text. */
export type ApiErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'pending'
  | 'disabled'
  | 'invalid_credentials'
  | 'username_taken'
  | 'rate_limited'
  | 'conflict';

// Passwords never travel or rest in the clear: the browser stretches the
// password into `passwordKey` (see src/web/auth.ts) and the backend stores
// only a salted hash of that key.

export type ApiRequest = { session?: string } & (
  | { action: 'ping' }
  | { action: 'config' }
  | { action: 'register'; username: string; displayName?: string; passwordKey: string }
  | { action: 'login'; username: string; passwordKey: string }
  | { action: 'loginGoogle'; idToken: string }
  | { action: 'logout' }
  | { action: 'me' }
  | { action: 'updateProfile'; displayName?: string; allowAdminView?: boolean }
  | { action: 'changePassword'; oldPasswordKey?: string; newPasswordKey: string }
  | { action: 'linkGoogle'; idToken: string }
  | { action: 'adminUsers' }
  | {
      action: 'adminUpdateUser';
      userId: string;
      status?: UserStatus;
      role?: UserRole;
      newPasswordKey?: string;
    }
  | { action: 'adminDeleteUser'; userId: string }
  | { action: 'adminSetConfig'; registration?: RegistrationMode; googleClientId?: string }
  | { action: 'adminAudit' }
  /** `asUser`: an admin opening a consenting member's data, read-only. */
  | { action: 'load'; asUser?: string }
  | { action: 'save'; tables: Partial<AppData>; baseRevision?: number }
  | { action: 'quotes'; items: QuoteRequestItem[] }
  /** Daily closes from `from` (YYYY-MM-DD) to today. */
  | { action: 'history'; items: QuoteRequestItem[]; from: string }
);

export type ApiResponse =
  | {
      ok: true;
      backend?: string;
      revision?: number;
      tables?: Partial<AppData>;
      quotes?: QuoteResult[];
      history?: HistoryResult[];
      config?: ServerConfig;
      user?: PublicUser;
      users?: PublicUser[];
      /** Session token: present after a successful login or registration. */
      session?: string;
      audit?: AuditEntry[];
    }
  | { ok: false; error: ApiErrorCode | (string & {}); revision?: number };
