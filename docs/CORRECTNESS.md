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

| §   | Requirement                                                 | Status                    | Evidence / notes                                                                                                                                                                        |
| --- | ----------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | No look-ahead / point-in-time                               | ✅ **proven**             | `evaluate.ts` reads only `i - offset` and `i-1`; **leak gate** proves future-invariance empirically                                                                                     |
| 2.2 | Realistic fills (next-bar-open default, never signal close) | ✅ **proven for default** | `resolveFill` default `nextOpen` → `candles[idx+1].o`; checkpoint test proves it across a gap. ⚠️ the optional `close`/`signalPrice` fill models DO fill at the signal bar — see gap G1 |
| 2.2 | Slippage + commission                                       | ✅                        | `applySlippage` (always adverse) + `commissionFor` (per-share/trade/percent), both legs in P&L                                                                                          |
| 2.3 | Liquidity cap (% of bar volume)                             | ❌ **gap G2**             | no volume-based fill cap yet                                                                                                                                                            |
| 2.4 | Survivorship-free PIT universe                              | ❌ **gap G3**             | data-layer work (P1)                                                                                                                                                                    |
| 2.5 | Corporate actions (PIT)                                     | ⚠️ **gap G4**             | relies on FMP adjusted EOD; needs explicit verification + split/dividend handling                                                                                                       |
| 2.6 | Correct accounting (integer sizing, cash/margin, sessions)  | ✅ mostly                 | integer `floor` sizing, long/short cash settlement, session filter exists; margin/borrow not modeled (G5)                                                                               |
| 2.7 | Determinism                                                 | ✅ **proven**             | determinism test in `engine.spec.ts`; only `runId`/`computedAt` vary                                                                                                                    |

### Known correctness gaps (tracked)

- **G1 — lookahead-optimistic fill models.** `fillOn: 'close' | 'signalPrice'` fill at
  the signal bar, violating §2.2's "never fill at the signal bar's close." Action:
  gate these behind an explicit "research only" flag and surface a warning in the
  audit record; keep `nextOpen` (or worse) as the only default.
- **G2 — no liquidity cap.** Add `maxBarVolumePct` to execution; cap fill qty at
  `floor(bar.volume × pct)` and record partial fills.
- **G3 — survivorship-free PIT universe.** Build the source-agnostic universe
  interface with two providers: explicit symbol lists **and** best-effort FMP PIT
  membership (delisted list + historical constituents), with coverage gaps flagged
  in the audit record.
- **G4 — corporate actions.** Verify FMP adjustment; implement PIT split/dividend
  handling and symbol-change mapping.
- **G5 — margin / borrow / HTB.** Model borrow cost + hard-to-borrow for shorts;
  margin and portfolio financing.

---

## 3. Roadmap to enterprise grade (build order + gates)

Status: ✅ done · 🟡 partial · ⬜ not started

| Phase  | Scope                                                                                                                   | Status                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1     | Data layer: FMP adapter, PIT store, all timeframes (incl. resampled W/M), corporate actions, survivorship-free universe | 🟡 adapter + intraday/daily + weekly resample + cache exist; PIT universe (G3), monthly, corp-actions (G4) pending                                             |
| P2     | Correctness core + event-driven engine + fill/cost model                                                                | 🟡 point-in-time + next-bar-open + slippage/commission proven; liquidity cap (G2), advanced orders pending                                                     |
| P3     | Rule builder: indicators, operator grammar, rule-tree JSON, **closed-bar** eval                                         | 🟡 registry indicators + nestable AND/OR + cross/compare operators + serializable spec exist; missing operators (state/sequence/persistence, MTF refs) tracked |
| P4     | Execution: order types, sizing, risk controls, full lifecycle (scale-in/out, re-entry)                                  | 🟡 market fills, 4 sizing modes, stops/targets/trailing, pyramiding; brackets/OCO/limit-stop, scale-out, portfolio heat pending                                |
| **P5** | **Validation suite (§6) + analytics (§7)**                                                                              | 🟡 **LEAK GATE ✅**, walk-forward ✅; CPCV+purge/embargo, DSR, PBO, Monte-Carlo null baseline, parameter-plateau heatmaps ⬜                                   |
| P6     | Optimization (grid/random/Bayesian/genetic) with walk-forward baked in                                                  | 🟡 grid sweep + anchored walk-forward exist; robust objectives (OOS-deflated Sharpe), random/Bayesian/genetic ⬜                                               |
| P7     | Reporting/tearsheets + paper-trade/forward bridge                                                                       | 🟡 charts + CSV/Excel/JSON export exist; tearsheet PDF, paper engine, divergence monitor ⬜                                                                    |
| P8     | Platform: reproducibility, experiment tracking, **audit records**                                                       | ⬜ versioned runs exist; per-result audit record (fill model, costs, data version, slippage, leak-gate verdict) ⬜                                             |

### The gates (no result is "trusted" until these pass)

- **After P2:** render a known trade and prove next-bar-open fill — ✅ done (`leak-gate.spec.ts`).
- **LEAK GATE (after P5):** a planted leak must be caught — ✅ done.
- **Before trusting any optimization:** show DSR > 0, PBO < 0.5, and a parameter
  **plateau** (not a lone spike) — ⬜ pending P5/P6.
- **Before forward/live:** paper engine reproduces backtest fills bit-for-bit — ⬜ pending P7.

---

## Operating principle

Correctness over features; a real small edge beats a fake large one. When a result
looks too good, **assume a leak and hunt it first**. The rule builder and the engine
share one spec, so what you build in the UI is exactly what gets tested — no gap.
