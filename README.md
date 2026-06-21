# Strategies Tester

A personal-use **visual trading-strategy backtester**. Build a strategy in a visual editor, run it against historical market data, and review institutional-grade analytics — all in one SvelteKit app.

Every control in the UI edits a single serializable object, the **`StrategySpec`**. That spec is the contract: it is sent to a server-side engine that computes indicators and runs the backtest, then the results UI renders what comes back. **No indicator or P&L math runs on the client** — the server is the single source of truth.

## Stack

- **SvelteKit 2** + **Svelte 5** (runes only) + **TypeScript** (strict)
- **Backend in the same app** — server-only modules under `src/lib/server/**`, exposed via `+server.ts` API routes. So the `StrategySpec` / `BacktestResult` types are shared verbatim between client and server (zero contract drift).
- **Market data:** [Financial Modeling Prep (FMP)](https://financialmodelingprep.com) `/stable/` Chart API, fetched **server-side only** (API key never reaches the browser). Candles are cached in the DB.
- **Database:** Drizzle ORM + SQLite (`better-sqlite3`). No auth (single user).
- **Charts:** SVG + `d3-scale` (token-themed, responsive, accessible). Price candlesticks are rendered from FMP data with per-trade entry/exit markers.
- **Icons:** `phosphor-svelte`. **Exports:** strategy JSON (lossless round-trip), results CSV, results Excel (`.xlsx` via ExcelJS).
- **Deployment:** `@sveltejs/adapter-node` (Node server; required for native `better-sqlite3` + persistent SQLite).

## Prerequisites

- Node ≥ 20, **pnpm**
- An FMP API key (the Ultimate plan unlocks intraday + long history)

## Setup

```sh
pnpm install

# Configure environment (see .env.example)
cp .env.example .env
#   DATABASE_URL=local.db
#   FMP_API_KEY=<your key>

# Create the SQLite schema
pnpm db:migrate

# Run
pnpm dev            # http://localhost:5173 → /backtest
```

> Without `FMP_API_KEY`, the app still runs and the builder works; running a backtest returns a clear `502` ("Market data unavailable"). Everything except live data fetches is exercisable.

## Scripts

| Script                                                    | Purpose                                   |
| --------------------------------------------------------- | ----------------------------------------- |
| `pnpm dev`                                                | Dev server                                |
| `pnpm build` / `pnpm preview`                             | Production build (adapter-node) / preview |
| `pnpm check`                                              | `svelte-check` (strict typecheck)         |
| `pnpm test`                                               | Vitest unit suite                         |
| `pnpm lint` / `pnpm format`                               | Prettier + ESLint / auto-format           |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | Drizzle migrations / apply / studio       |

## How it works

- **`StrategySpec`** (`src/lib/types/`) — universe (tickers, timeframe, date range, session) · indicator instances (declared once, referenced by id) · rules (`longEntry/longExit/shortEntry/shortExit`, each a recursive AND/OR `ConditionGroup` of type-aware conditions with bar-offset operands) · risk (sizing, stops, targets, trailing, pyramiding, commission, slippage) · execution (fill model). Exhaustive discriminated unions make an invalid spec unconstructible at compile time.
- **Capabilities are schema-driven.** `GET /api/capabilities` returns the indicator catalog (with param schemas), operators, timeframes, etc.; the builder renders entirely from it, so adding a server-side indicator surfaces it in the UI automatically.
- **Correctness.** Signals are evaluated point-in-time; the default fill is **next bar open** (no look-ahead). The fill model is explicit in the execution panel. `StrategySpec` round-trips losslessly to/from JSON.
- **Results.** `POST /api/backtest` returns a `BacktestResult` (summary metrics, equity & drawdown curves, full trade ledger with MAE/MFE/exit reason/R, monthly returns, return distribution, and per-ticker FMP candles). The summary cards are driven by the returned metric set.

## API routes (`src/routes/api/`)

`GET /capabilities` · `POST /backtest` · `GET /runs/[runId]` · `GET /candles` · `GET|POST /strategies` · `GET|PUT|DELETE /strategies/[id]` · `POST /strategies/[id]/duplicate` · `GET /strategies/[id]/versions`

## Project structure

```
src/
  lib/
    types/         # the StrategySpec / Capabilities / BacktestResult contract (shared)
    validation/    # zod schemas, type guards, path-keyed semantic validation
    api/           # typed client used by load functions + stores
    stores/        # class-based rune stores (strategy.svelte.ts, strategies.svelte.ts)
    components/     # builder/, results/, strategies/, shell/, ui/
    charts/        # SVG + d3 charts (equity, drawdown, heatmap, histogram, candlestick)
    export/        # CSV, XLSX (ExcelJS, lazy-loaded), JSON
    server/        # SERVER-ONLY: fmp/ (data client), indicators/, engine/, db/
  routes/
    backtest/                    # builder (?strategyId=&version= hydrates a saved version)
    backtest/results/[runId]/    # analytics
    strategies/                  # save / load / duplicate / delete / versions / import-export
    api/                         # see above
```

## Testing

`pnpm test` covers spec validation, type guards, JSON serialization round-trip, indicator correctness vs. fixtures, backtest determinism, the **no-look-ahead** invariant, and the export pipeline.
