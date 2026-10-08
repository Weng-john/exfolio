# exfolio — Project Specification

## Goal

Build the exposure-based portfolio management website described in
`private/portfolio_management_spec.md` (a private, git-ignored file the
Human copies into each task clone; never commit it or quote it at length): a personal asset-allocation site that uses
NAV as the denominator and real market exposure as the core measure.

## Baseline

`main` holds the foundation every task builds on:

- `src/core/` — pure TypeScript engine. `types.ts` is the data model,
  `ledger.ts` replays transactions into positions / cash / loan balances,
  `valuation.ts` derives NAV, exposure and leverage.
- `src/web/` — React app. `store.ts` is the only way pages read and write
  data (`useData`, `upsertRow`, `removeRow`, `setTable`); `usePortfolio()`
  returns the current ledger and valuation; `components/ui.tsx` and
  `format.ts` hold the shared UI pieces and number formatting.
- `server/` — local Node backend (JSON store + quote proxy).
- `src/core/api.ts` — the wire protocol shared with the GAS backend.

## Data

No research datasets. Personal financial data never enters the repository;
see `docs/PRIVACY.md`. Tests and examples use fictional numbers only.

## Expected Outputs

Working pages and engine modules for the phase a task is assigned, with
unit tests for every calculation added to `src/core/`.

## Acceptance Criteria

- `npm test`, `npm run typecheck`, `npm run build` and
  `npm run check:privacy` all pass.
- Calculations live in `src/core/` as pure functions with tests; pages only
  call them.
- Accounting rules of the product spec hold: exposure is signed and
  NAV-denominated, futures margin is neither exposure nor debt, internal
  transfers are never P&L, nothing is counted twice.
- No leverage cap is enforced anywhere: thresholds only raise alerts.

## Notes

- UI text is Traditional Chinese; financial terms may stay in English.
- Keep changes inside the files a task is assigned. Changing
  `src/core/types.ts`, `src/web/store.ts`, `src/web/App.tsx` or
  `src/web/components/ui.tsx` affects every other task: report the need
  instead of editing them, unless the task says otherwise.
- Node is not on the default PATH on this machine:
  `export PATH=$HOME/miniconda3/envs/agent/bin:$PATH`.
