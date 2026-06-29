# Strategies Tester

A personal-use **visual trading-strategy backtester**. Build a strategy in a visual editor, run it against historical market data, and review institutional-grade analytics — all in one SvelteKit app.

Every control in the UI edits a single serializable object, the **`StrategySpec`**. That spec is the contract: it is sent to a server-side engine that computes indicators and runs the backtest, then the results UI renders what comes back. **No indicator or P&L math runs on the client** — the server is the single source of truth.

## Stack

- **SvelteKit 2** + **Svelte 5** (runes only) + **TypeScript** (strict)
- **Backend in the same app** — server-only modules under `src/lib/server/**`, exposed via `+server.ts` API routes. So the `StrategySpec` / `BacktestResult` types are shared verbatim between client and server (zero contract drift).
- **Market data:** [Financial Modeling Prep (FMP)](https://financialmodelingprep.com) `/stable/` Chart API, fetched **server-side only** (API key never reaches the browser). Candles are cached in the DB.
- **Database:** Drizzle ORM + SQLite (`better-sqlite3`). No auth (single user).
- **Charts:** SVG + `d3-scale` (token-themed, responsive, accessible). Price candlesticks are rendered from FMP data with per-trade entry/exit markers.
- **Icons:** `phosphor-svelte`. **Exports:** strategy JSON (lossless round-trip), results CSV, Excel (`.xlsx` via ExcelJS), full-result JSON, and a standalone HTML **tearsheet**.
- **Deployment:** `@sveltejs/adapter-node` (Node server; required for native `better-sqlite3` + persistent SQLite).

## What it does

Correctness-first: the headline property is that **results are real** — defensible against look-ahead, fill optimism, survivorship bias and overfitting.

- **Leak gate (proven, not asserted).** A future-invariance detector corrupts all bars after a cut point and verifies every already-settled trade is byte-identical; it passes the real engine and is proven to **catch a planted cheater**. (`src/lib/server/engine/leak-gate.ts`)
- **Execution.** Next-bar-open default fills; market / **limit / stop** entry orders; slippage, commission, **liquidity cap** (% of bar volume), short **borrow cost**. Stops: percent / points / ATR / **trailing** / **time-based**. Risk: **drawdown circuit-breaker**, **portfolio heat cap**, max-concurrent, pyramiding.
- **Sizing.** Fixed shares / notional / %-equity / risk-based / **volatility-target (ATR)** / **fractional-Kelly** (point-in-time edge).
- **Rule grammar.** Recursive AND/OR groups · crossover/state/compare/unary/range · **aggregate operands** (highest/lowest/mean/sum of N) · **persistence** ("holds for N bars") · **sequence** ("A then B within K") · **multi-timeframe** indicator references (e.g. 1-day filter under a 5-min trigger), leak-safe.
- **Data.** FMP intraday + daily, leak-free **weekly/monthly** resample, **split/dividend-adjusted** prices, and a **survivorship-free point-in-time universe** (explicit list or FMP index membership incl. delisted names) usable both in the `/universe` explorer and directly in a run.
- **Validation (the anti-overfit gate).** Walk-forward, **CPCV** (purge + embargo), **Deflated Sharpe**, **PBO** (CSCV), **Monte-Carlo** (trade-order shuffle, bootstrap, randomized-entry null), and **parameter-plateau** detection — surfaced with a pass/warn/fail verdict.
- **Optimization.** Grid / **random** / **genetic** search with robust objectives; walk-forward baked in.
- **Analytics.** CVaR, ulcer index, Calmar, Omega, time-underwater, losing-streak, attribution (symbol/side/exit), per-year regime, benchmark alpha/beta.
- **Forward testing.** A paper bridge runs the **same engine** on the latest data to report current positions + live signals, with a backtest-vs-live divergence monitor.
- **Audit.** Every result carries an audit record (fill model, costs, liquidity cap, data assumptions) so it's reproducible.

## Prerequisites

- **Node 24.18.0 LTS** (pinned in `.nvmrc` / `.node-version`; enforced via `engines` ≥ 24.18.0)
- **pnpm 11** — pinned via `packageManager`; run `corepack enable` to use it automatically
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

You can provide the FMP key two ways: the `FMP_API_KEY` env var (above), or **in-app at `/settings`** — type it there and it's stored server-side (local SQLite) and takes precedence over the env var. The Settings page also has a **Test connection** button. The key is never sent back to the browser.

> Without a key, the app still runs and the builder works; running a backtest returns a clear `502` ("Market data unavailable"). Everything except live data fetches is exercisable.

## Scripts

| Script                                                    | Purpose                                   |
| --------------------------------------------------------- | ----------------------------------------- |
| `pnpm dev`                                                | Dev server (UI + API + engine + DB)       |
| `pnpm dev:all`                                            | Migrate DB, then start the dev server     |
| `pnpm build` / `pnpm preview`                             | Production build (adapter-node) / preview |
| `pnpm check`                                              | `svelte-check` (strict typecheck)         |
| `pnpm test`                                               | Vitest unit suite                         |
| `pnpm lint` / `pnpm format`                               | Prettier + ESLint / auto-format           |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | Drizzle migrations / apply / studio       |

## How it works

- **`StrategySpec`** (`src/lib/types/`) — universe (tickers, timeframe, date range, session) · indicator instances (declared once, referenced by id) · rules (`longEntry/longExit/shortEntry/shortExit`, each a recursive AND/OR `ConditionGroup` of type-aware conditions with bar-offset operands) · risk (sizing, stops, targets, trailing, pyramiding, commission, slippage) · execution (fill model). Exhaustive discriminated unions make an invalid spec unconstructible at compile time.
- **Capabilities are schema-driven.** `GET /api/capabilities` returns the indicator catalog (with param schemas), operators, timeframes, etc.; the builder renders entirely from it, so adding a server-side indicator surfaces it in the UI automatically.
- **Correctness.** Signals are evaluated point-in-time; the default fill is **next bar open** (no look-ahead), proven by the leak gate. The fill model is explicit in the execution panel (lookahead-optimistic models are flagged in the result). `StrategySpec` round-trips losslessly to/from JSON. Same data + code + config ⇒ identical result.
- **Results.** `POST /api/backtest` returns a `BacktestResult` (summary metrics, equity & drawdown curves, full trade ledger with MAE/MFE/exit reason/R, monthly returns, return distribution, optional benchmark overlay, per-ticker FMP candles, and an audit record). The results page also runs on-demand **statistical validation** and **performance analytics**.

## API routes (`src/routes/api/`)

`GET /capabilities` · `POST /backtest` · `GET /runs/[runId]` · `GET /candles` · `POST /optimize` (grid/random/genetic) · `POST /walkforward` · `POST /validate` (single | optimization) · `GET /analytics` · `POST /universe` · `POST /paper` · `GET|PUT|DELETE /settings` · `GET|POST /strategies` · `GET|PUT|DELETE /strategies/[id]` · `POST /strategies/[id]/duplicate` · `GET /strategies/[id]/versions`

See **`docs/CORRECTNESS.md`** for the leak gate, the §2 correctness audit, and the full roadmap status.

## Project structure

```
src/
  lib/
    types/         # the StrategySpec / Capabilities / BacktestResult contract (shared)
    validation/    # zod schemas, type guards, path-keyed semantic validation
    api/           # typed client used by load functions + stores
    stores/        # class-based rune stores (strategy.svelte.ts, strategies.svelte.ts)
    components/     # builder/, results/, strategies/, validation/, shell/, ui/
    charts/        # SVG + d3 charts (equity, drawdown, heatmap, histogram, candlestick)
    export/        # CSV, XLSX (ExcelJS, lazy-loaded), JSON, HTML tearsheet
    server/        # SERVER-ONLY:
      fmp/         #   data client (adjusted EOD, intraday, weekly/monthly resample, cache)
      indicators/  #   registry + pure compute fns
      engine/      #   engine, evaluate, metrics, leak-gate, mtf, optimize, search, analytics, benchmark, walkforward
      validation/  #   stats, DSR, PBO/CSCV, CPCV, Monte-Carlo, report
      universe/    #   PIT providers (explicit + FMP), resample, select
      paper/       #   forward-testing bridge
      db/          #   Drizzle schema + repository
  routes/
    backtest/                    # builder (?strategyId=&version= hydrates a saved version)
    backtest/results/[runId]/    # analytics + validation
    strategies/                  # save / load / duplicate / delete / versions / import-export
    optimize/                    # grid/random/genetic + walk-forward + validation
    universe/                    # PIT universe explorer
    paper/                       # forward-testing / live signals
    settings/                    # FMP API key (server-side)
    api/                         # see above
```

## Testing

`pnpm test` (300+ tests) covers spec validation, type guards, JSON round-trip, indicator correctness, backtest determinism, the **no-look-ahead invariant + the leak gate (incl. a planted-cheater test)**, the full **validation suite** (DSR, PBO, CPCV, Monte-Carlo, plateau), analytics, MTF alignment, order types, and the export pipeline.
