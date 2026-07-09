# Pricing Pack — Position Assistant

## Context

Ivo asked the production agent "At what price level am I short on average Grinders" and it correctly declined — the parser drops the price columns. But the daily SOL ReportLogistic export carries full sale-side pricing, so the question is accurately answerable. Data study on the real 2026-06-18 export (62 unallocated rows → 61 contract+month aggregates):

- `S.Dif` / `S.Fob dif` (differential vs NY KC, USc/lb): populated **62/62** — the reliable "price level".
- `S. Price` (flat): only 29/62 nonzero — the rest are price-to-be-fixed (PTBF). Units mixed: USC/LB ×55, USD/KG ×4, USD/MT ×3.
- `sFixDte` populated 62/62 (already parsed today); `S.Term` mixed (FOB/CIF/DAP/…) — explains contract dif ≠ FOB dif.
- Purchase-side price fields are all **zero** on unallocated rows → long-book cost basis is OUT of scope.
- Golden BASE FILE fixture + demo seed have **no** price fields → parity must compare against independently hand-computed constants (derived, below); demo seed gets enriched from the real export.

**User decisions (locked):** present contract dif AND FOB dif side by side, no headline metric; enrich the demo seed with real prices joined by contract.

## Independently derived expected values (embed in parity [9])

From the raw TSV, aggregated by (Sale Ctr., delivery month), SMT-weighted:

- 61 aggregated sales, total SMT −2,907.81
- overall wavg contract dif **84.0236** USc/lb, FOB dif **72.4717**
- fixed: 28 contracts / −639.81 MT, wavg flat **326.9371** USc/lb (unit-normalized); PTBF: 33 / −2,268.0 MT
- by fix month (dif, SMT): KCH/2025 34.29/−1.2 · KCH/2027 94.2174/−496.8 · KCK/2026 451.3/−0.24 · KCN/2026 51.7728/−506.37 · KCU/2025 −19.0/−43.2 · KCU/2026 130.6236/−936.0 · KCZ/2026 53.7974/−924.0
- NESTRADE client wavg dif 144.5596
- Unit conversion: 1 USc/lb = 22.046226218487757 USD/MT; USD/KG = ×1000 USD/MT.

## What the pack will answer accurately (and what it won't)

Answerable: avg differential (contract + FOB, USc/lb) of the shorts book — overall and by sold grade, POST grade (blend-allocation-weighted), client, delivery month, fixation month; fixed vs PTBF split (volume + avg flat price where fixed); all with explicit coverage counts (sales lacking a dif are excluded from averages and reported, never guessed).
Not answerable (tool/agent must keep declining): long-book cost basis, mark-to-market/P&L (no market quotes anywhere in the data), price history/trends (single-snapshot), trade advice.

## Implementation

Follow superpowers TDD: write parity/unit expectations first, then code. Commit task-wise, no Co-Authored-By trailer.

1. **`src/lib/types.ts`** — extend `Sale` with optional `sPrice`, `sPriceUnit`, `sDif`, `sFobDif`, `sTerm` (all `| null`).
2. **`src/lib/units.ts`** — add `USD_MT_PER_USC_LB = 22.046226218487757` and `priceToUscLb(price, unit)` ('USC/LB' | 'USD/KG' | 'USD/MT' → USc/lb; unknown unit → null).
3. **`src/lib/parse.ts`** — `parseReportLogistic`: capture `S. Price`, `S. Unit`, `S.Dif`, `S.Fob dif`, `S.Term` (reuse `columnIndex`/`toNum`). `aggregateSales`: SMT-weighted average of dif/fobDif/price on merge; keep unit if consistent across merged rows, else null.
4. **New `src/lib/pricing.ts`** (pure, no Lua imports, tsx-runnable) — `computePricing(sales, blends?, opts?)`:
   - excludes sales with null/undefined `sDif` from averages; returns `coverage {priced, unpriced, unpricedContracts[]}`
   - `overall`: smt, wavg contract dif, wavg FOB dif, `fixed {contracts, smt, wavgFlatUscLb}`, `ptbf {contracts, smt}`
   - `by(dimension)`: soldGrade | client | deliveryMonth | fixMonth (SMT-weighted); postGrade weighted by blend-allocated bags (`saleMtToBags(smt, fraction)`, reusing recipe walk from `shorts.ts`); each bucket carries both difs + smt + contract count.
5. **`src/skills/query.skill.ts`** — new `price-analytics` tool in `position-query`: input `{positionDate?, dimension?, grade?, client?, month?, fixMonth?}` (reuse `dateField`, `findGradeKey` fuzzy grade match); reads snapshot `sales` via `getSnapshot`, loads blends from Data-API for the postGrade dim; returns both difs side by side + fixed/PTBF + coverage. Skill `context` additions: "price level" = differential vs NY in USc/lb, always present contract dif AND FOB dif together (no headline), state coverage and PTBF share, decline cost-basis/P&L/advice. Also add the nit fix: "Never label net values as 'longs' — longs = theoretical stock, net = longs + shorts."
6. **`src/seed/demo.ts`** — enrich `DEMO_SALES` (60 BASE FILE sales) with price fields joined from `forecast-context/ReportLogistic20260618-IVO.xls` by (saleCtr, month) — generate via scratch script; unmatched contracts (known drift, e.g. SSKE-98454 exists only in the export) keep nulls. Snapshots store `sales` verbatim (`saveSnapshot(positionDate, { sales })` in `src/skills/ingestion.skill.ts:94`), so fields flow through ingestion, blend assignment (`forwardsales.skill.ts` re-saves), and demo load with zero store changes.
7. **`src/__tests__/parity.ts`** — new section **[9] Pricing** : parse the real ReportLogistic with the real parser → `computePricing` → assert the constants above (±0.01); plus demo-seed enrichment check (joined contracts match export values; unmatched count stated). Keep exit-0 = all green.

## Verification

- `npx tsx src/__tests__/parity.ts` → 9 sections, exit 0; `npx tsc --noEmit` clean; `npx lua compile --ci` → 24 primitives (new tool).
- Sandbox: `npx lua test skill --name price-analytics --input '{}'` and with `{"dimension":"postGrade","grade":"grinder"}` after `load-demo-snapshot` → grinder avg difs present, coverage stated.
- Conversational: `npx lua chat -e sandbox -t pricing-qa -m "At what price level am I short on average Grinders"` → both difs, PTBF share, no advice; also ask a cost-basis question → agent declines accurately.
- Then `lua push all --force`; deploy via `/lua-deploy` (never bare `lua deploy`).

## Notes / caveats to surface in tool output

- Differentials assumed USc/lb across all rows (consistent in data; flag for Ivo to confirm).
- Mixed Incoterms (FOB/CIF/DAP) — that's why the two difs differ; both always shown.
- `S.Hedge Value` semantics (1 vs 4) unknown — not used in v1.
- Prices attach to sale contracts; POST-grade attribution goes through blend fractions — validate one real answer with Ivo before the desk trusts the postGrade dim.
- Also write the spec doc to `docs/superpowers/specs/2026-07-10-pricing-pack-design.md` (brainstorming skill step) and update `SESSION` log at the end.
