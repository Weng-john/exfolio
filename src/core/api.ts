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
  /** False when only Google sign-in is accepted. Absent means true. */
  passwordLogin?: boolean;
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
  | 'conflict'
  /** This backend accepts Google sign-in only. */
  | 'password_disabled'
  /** No room for new accounts: too many members or too many awaiting approval. */
  | 'registration_full';

// ---- Read-only exchange sync -------------------------------------------

export type IntegrationProvider = 'binance';

/** A stored exchange connection, as shown to its owner. Never the key itself. */
export interface IntegrationInfo {
  id: string;
  provider: IntegrationProvider;
  label: string;
  /** Last characters of the API key, to tell connections apart. */
  keyHint: string;
  createdAt: string;
  lastSyncAt?: string;
}

export interface IntegrationStatus {
  /** False when the backend cannot keep secrets safely; `reason` says why. */
  enabled: boolean;
  reason?: string;
  list: IntegrationInfo[];
}

export interface ExchangeBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface ExchangePosition {
  symbol: string;
  /** Signed contracts: negative when short. */
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
}

/** What the exchange reports right now: balances and open derivative positions. */
export interface ExchangeSnapshot {
  fetchedAt: string;
  balances: ExchangeBalance[];
  /** Balances of the derivatives wallet. */
  futuresBalances: ExchangeBalance[];
  positions: ExchangePosition[];
  warnings: string[];
}

export interface ExchangeTrade {
  /** Stable id from the exchange. */
  id: string;
  market: 'spot' | 'futures';
  symbol: string;
  time: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fee: number;
  feeAsset: string;
  /** Realized P&L the exchange booked on this fill (futures). */
  realizedPnl?: number;
}

// The password itself never travels or rests anywhere: the browser stretches
// it into `passwordKey` (see src/web/auth.ts) and the backend stores only a
// salted hash of that key. The key is still a credential — whoever captures
// one can sign in with it — so a backend must only ever be reached over
// HTTPS or on this machine.

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
  | { action: 'integrationStatus' }
  /** The key must be read-only: the backend checks and refuses otherwise. */
  | {
      action: 'integrationSave';
      provider: IntegrationProvider;
      label: string;
      apiKey: string;
      apiSecret: string;
    }
  | { action: 'integrationDelete'; id: string }
  | { action: 'integrationSync'; id: string }
  | {
      action: 'integrationTrades';
      id: string;
      market: 'spot' | 'futures';
      symbol: string;
      since?: string;
    }
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
      integrations?: IntegrationStatus;
      snapshot?: ExchangeSnapshot;
      trades?: ExchangeTrade[];
    }
  | { ok: false; error: ApiErrorCode | (string & {}); revision?: number };
