# Correctness & the Leak Gate

> A backtest's job is to estimate **out-of-sample** edge, not to maximize in-sample
> return. If the engine can "see" the future at any point, the results are fiction.
> Correctness and validation are **hard gates** — features mean nothing until they pass.

This document records what is **proven** correct in the engine today, how the **leak
gate** works, and the prioritized roadmap to enterprise grade. Nothing here is
described as "validated" on the strength of a code read alone — every correctness
claim is backed by an executable test.

---

## 1. The Leak Gate (mandatory checkpoint — spec §0 / §2.1 / §6)

**File:** `src/lib/server/engine/leak-gate.ts` · **Proof:** `leak-gate.spec.ts`

### The invariant

> A backtest has no look-ahead **iff**, for any cut point `K` in time, every trade
> already **fully settled at/before bar `K`** is unchanged when all bars strictly
> after `K` are replaced with arbitrary (adversarial) values.

If we corrupt the future and a trade that finished in the past changes, the engine
must have read that future to produce it — a leak, by definition. This is the
gold-standard, **engine-agnostic** test: it makes zero assumptions about _how_ the
runner works.

### How it works

1. `perturbAfter(candles, K)` — replaces OHLCV of every bar after `K` with extreme
   oscillating garbage while **preserving timestamps** (so only _price_ information
   is corrupted, not timeline alignment). Each emitted bar is still a valid candle.
2. `detectLookahead(run, candles)` — for ~12 evenly-spaced cuts, perturbs the
   future, re-runs, and compares **in order** every trade whose exit falls at a bar
   `≤ K`. Any add / remove / change is proof of a leak, returned as concrete
   `evidence` (the cut, the clean projection, the perturbed projection).
3. `runLeakGate(spec, candlesByTicker)` — runs the gate against the **real engine**,
   isolating each ticker as its own series (the engine's entire look-ahead surface
   is per-ticker: indicator/price access + the next-bar-open fill).
4. `assertNoLookahead(...)` — throws if a leak is detected; for engine self-tests.

### What the proof asserts (`leak-gate.spec.ts`, 6 tests)

| Test                                             | Proves                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| real engine is future-invariant                  | `leaked === false`, and it actually compared **>0** settled trades (not a vacuous pass)                                                  |
| `runLeakGate` multi-ticker + `assertNoLookahead` | the gate passes the real engine end-to-end                                                                                               |
| **planted leak is caught**                       | an "oracle" runner that bakes a _future_ bar into a settled trade's exit price is flagged `leaked === true` with evidence                |
| clean version of the same shape                  | the _non-peeking_ twin of the oracle passes — the gate isn't just always-firing                                                          |
| `perturbAfter`                                   | corrupts only the future, preserves all timestamps, emits valid candles                                                                  |
| **next-bar-open checkpoint**                     | a known crossover trade fills at the **following bar's open** across a price gap — explicitly **not** the signal bar's close (spec §2.2) |

> **If the planted-leak test ever passes, the harness is broken — fix it before
> anything else proceeds.** (spec §0)

### Run it

```sh
pnpm test -- leak-gate          # just the gate
pnpm test                       # full suite
```

---

## 2. Correctness audit of the current engine (vs spec §2)

Verified against `engine.ts` + `evaluate.ts`, each claim backed by a test.

| §   | Requirement                                                 | Status        | Evidence / notes                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | No look-ahead / point-in-time                               | ✅ **proven** | `evaluate.ts` reads only `i - offset` and `i-1`; **leak gate** proves future-invariance empirically                                                                                                                                                   |
| 2.2 | Realistic fills (next-bar-open default, never signal close) | ✅ **proven** | `resolveFill` default `nextOpen` → `candles[idx+1].o`; checkpoint test proves it across a gap. The optional `close`/`signalPrice` models are flagged lookahead-optimistic in `result.warnings` (G1 closed). Limit/stop entry orders also implemented. |
| 2.2 | Slippage + commission + borrow                              | ✅            | `applySlippage` (always adverse) + `commissionFor`, both legs in P&L; short borrow cost (`shortBorrowAPR`) accrued per bar held                                                                                                                       |
| 2.3 | Liquidity cap (% of bar volume)                             | ✅            | `execution.maxBarVolumePct` caps fill qty at `floor(bar.volume × pct/100)`; warns once per run (G2 closed)                                                                                                                                            |
| 2.4 | Survivorship-free PIT universe                              | ✅            | `server/universe/` — explicit + FMP PIT providers (delisted names, coverage gaps); usable in the `/universe` explorer **and** wired into runs via `universe.source` (G3 closed)                                                                       |
| 2.5 | Corporate actions (PIT)                                     | ✅            | daily fetch uses FMP's **dividend-adjusted** EOD endpoint; `applyAdjustment` prefers adjusted OHLC or scales by `adjClose/close`; weekly/monthly inherit it (G4 closed)                                                                               |
| 2.6 | Correct accounting (integer sizing, cash, sessions)         | ✅ mostly     | integer `floor` sizing, long/short cash settlement, session filter, heat cap + drawdown circuit-breaker; full margin/leverage not modeled (G5)                                                                                                        |
| 2.7 | Determinism                                                 | ✅ **proven** | determinism test in `engine.spec.ts`; seeded RNG for all Monte-Carlo; only `runId`/`computedAt` vary                                                                                                                                                  |

### Known correctness gaps (tracked)

- **G1 — lookahead-optimistic fill models.** ✅ **Closed** — `fillOn: 'close' | 'signalPrice'`
  now emit a loud `lookahead-optimistic` warning in the result; `nextOpen` is the only
  realistic default and the `audit.lookaheadOptimistic` flag records it.
- **G2 — liquidity cap.** ✅ **Closed** — `execution.maxBarVolumePct`.
- **G3 — survivorship-free PIT universe.** ✅ **Closed** — explicit + FMP PIT providers,
  wired into runs (`universe.source`), coverage gaps surfaced.
- **G4 — corporate actions.** ✅ **Closed** — dividend-adjusted EOD + `applyAdjustment`.
- **G5 — margin / leverage.** 🟡 Partial — short borrow cost modeled; full margin /
  portfolio financing / hard-to-borrow not yet.

---

## 3. Roadmap to enterprise grade (build order + gates)

Status: ✅ done · 🟡 partial · ⬜ not started

| Phase  | Scope                                                                                                                   | Status                                                                                                                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1     | Data layer: FMP adapter, PIT store, all timeframes (incl. resampled W/M), corporate actions, survivorship-free universe | ✅ adapter + intraday/daily + weekly/**monthly** resample + cache + **dividend-adjusted** prices + **PIT universe (explicit + FMP), wired into runs**                                                            |
| P2     | Correctness core + event-driven engine + fill/cost model                                                                | ✅ point-in-time + next-bar-open (proven) + slippage/commission/borrow + **liquidity cap** + **limit/stop orders** (bracket/OCO/stop-limit ⬜)                                                                   |
| P3     | Rule builder: indicators, operator grammar, rule-tree JSON, **closed-bar** eval                                         | ✅ registry indicators + nestable AND/OR + cross/compare/unary/range + **aggregate/persistence/sequence** + **multi-timeframe refs** + **scale-out/partial-profit**; re-entry ⬜                                 |
| P4     | Execution: order types, sizing, risk controls                                                                           | ✅ market/limit/stop fills, sizing (fixed/notional/%eq/risk/**vol-target/fractional-Kelly**), stops/targets/trailing/**time**, pyramiding, **heat cap + drawdown circuit-breaker**; sector/correlation limits ⬜ |
| **P5** | **Validation suite (§6) + analytics (§7)**                                                                              | ✅ **LEAK GATE**, walk-forward, **CPCV (purge+embargo), DSR, PBO (CSCV), Monte-Carlo null baseline, parameter-plateau**; analytics (CVaR/ulcer/Calmar/Omega/attribution/regime) — wired into the UI              |
| P6     | Optimization with walk-forward baked in                                                                                 | ✅ grid + **random** + **genetic** + **Bayesian (TPE)** + robust objectives (OOS-deflated proxy) + anchored walk-forward                                                                                         |
| P7     | Reporting/tearsheets + paper-trade/forward bridge                                                                       | ✅ charts + CSV/Excel/JSON + **HTML tearsheet** + **paper-trade/forward bridge** + divergence monitor; PDF export + live broker ⬜                                                                               |
| P8     | Platform: reproducibility, experiment tracking, **audit records**                                                       | ✅ versioned runs + **per-result audit record** (fill model, costs, liquidity cap, data assumptions) + determinism                                                                                               |

### The gates (no result is "trusted" until these pass)

- **After P2:** render a known trade and prove next-bar-open fill — ✅ done (`leak-gate.spec.ts`).
- **LEAK GATE:** a planted leak must be caught — ✅ done (and re-run against every engine
  feature added since: liquidity cap, orders, Kelly/borrow, MTF).
- **Before trusting an optimization:** DSR, PBO and a parameter plateau — ✅ available via
  `validateOptimization` and surfaced on the optimize page with a pass/warn/fail verdict.
- **Before forward/live:** the paper engine reproduces backtest fills bit-for-bit — ✅ it
  **is** the same engine (no logic fork); `divergence()` monitors live-vs-backtest drift.

### Remaining (niche / future)

Bracket-OCO/stop-limit/MOC-LOC order types · re-entry lifecycle · sector & correlation
exposure limits · full margin/leverage & hard-to-borrow · PDF tearsheet · a live broker adapter.

---

## Operating principle

Correctness over features; a real small edge beats a fake large one. When a result
looks too good, **assume a leak and hunt it first**. The rule builder and the engine
share one spec, so what you build in the UI is exactly what gets tested — no gap.
