# Client & Shipment Analytics — Position Assistant

## Context

Follow-up to the pricing pack (deployed v1.0.4): expose client/counterparty exposure and shipment-logistics status from the daily ReportLogistic export, accurately. Data study on the real 2026-06-18 export (62 rows, ALL status '6-Sales Unallocated' — Ivo's export is pre-filtered; there are no shipped/allocated rows, so "shipment analytics" = booking status of the forward book, not voyage tracking of past shipments).

Field coverage on the 62 rows (dedup headers: two Vessel/ETD/ETA/POD/TransType column pairs exist; the FIRST of each pair is the live booking leg, the second — cols 67+ — is entirely empty; `columnIndex` in `src/lib/parse.ts` already takes first match):

- **100%**: `S.City` (destination), `S.CodCountry`, `Payment term`, `Trader` (desk initials), plus already-parsed client/sGrade/SMT/month/difs. `S.Cert` 20/62 (EUDR flags).
- **Booking-stage subset**: `PreshipID` 18 rows (⚠️ `'0'` = empty for booking fields), `Booking Line` 17, `Vessel`/`Voy.Num`/`Booking num.`/`ETD` 13, `ETA` 10, `POL`/`POD`/`TransType` 18, `SI.Date` 14.
- **Empty on this book (tools must decline)**: B/L, container, lot, invoice/due date, consignee, warehouse, traceability, 2nd transport leg.

## Hand-computed constants (embed in parity [10]; ±0.01)

Aggregated by (Sale Ctr., month) = 61 contracts, total SMT −2,907.81:

- Top clients (contracts / SMT / share): KONINKLUJKE 8/−864.0/29.7%, NESTRADE 6/−784.8/27.0%, NESTLE SVE 10/−583.2/20.1%
- Booked (PreshipID set): **17 contracts / −528.12 MT**; vessel assigned: **12 / −410.52 MT**
- Booked/unbooked ladder by delivery month: 2026/05 [3,0], 2026/06 [9,13], 2026/07 [3,6], 2026/08 [2,7], 2026/09 [0,9], 2026/10 [0,4], 2026/11 [0,2] (+3 stray single months)
- By destination country (SMT): NETH −885.6, SWIT −784.8, SWED −583.2
- ETD months across vessel-assigned: 9× 2026-06, 3× 2026-07; top trader OCH 17 contracts

## Implementation (TDD; task-wise commits, no co-author trailer)

1. **`src/lib/types.ts`** — extend `Sale`: flat `sCity?`, `sCountry?`, `paymentTerm?`, `trader?`, `sCert?` (100%-coverage fields) + nested `booking?: { preshipId, line, vessel, voyage, bookingNum, transType, pol, pod, etd, eta, siDate } | null` (null when no booking-stage data).
2. **`src/lib/parse.ts`** — capture the columns above in `parseLogisticsReport` (normalize `'0'` → empty on booking fields; build `booking` only if ≥1 field present). `aggregateSales` merge: flat strings equal-or-null (existing `sTerm` pattern); `booking` = the non-null one, field-wise equal-or-null if both.
3. **New `src/lib/book.ts`** (pure, tsx-runnable) —
   - `computeClientExposure(sales)`: per client → contracts, smt, bags (`mtToBags`), sharePct, smt by delivery month, sold grades, destination countries, payment terms, traders; sorted by |smt|; total line.
   - `computeShipmentStatus(sales, {month?, client?})`: overall booked/unbooked/vesselAssigned {contracts, smt}; per-month ladder; `shipments[]` detail for booked contracts {saleCtr, client, month, smt, vessel, voyage, line, bookingNum, pol, pod, etd, eta} sorted by ETD.
4. **`src/skills/query.skill.ts`** — two tools in position-query (reuse `dateField`, `getSnapshot`):
   - `client-exposure` `{positionDate?, client?}` — client filter fuzzy-uppercase like price-analytics; point agent to price-analytics for the client's difs (don't duplicate).
   - `shipment-status` `{positionDate?, month?, client?, unbookedOnly?}` — ladder + booked detail; caveats: booking-stage data only, ETA on a subset, B/L/container/invoice/warehouse NOT in the export (decline).
   - Skill context: when to use each; "how short am I to X" → client-exposure; "what's booked/shipping" → shipment-status; decline container/invoice/warehouse questions explicitly.
5. **`.lua/enrich_demo.ts`** — extend to copy the new fields; regenerate `src/seed/demo.ts` (60/60 join by contract+month as before).
6. **`src/__tests__/parity.ts`** — section **[10] Client & shipment analytics**: real parser over the real export → both functions → assert the constants above; demo-seed spot-checks (booked count/SMT on seed, KONINKLUJKE totals survive the join).

## Verification

- `npx tsx src/__tests__/parity.ts` → 10 sections exit 0; `npx tsc --noEmit`; `npx lua compile --ci` → 26 primitives (19 tools).
- Sandbox `lua test`: `load-demo-snapshot` → `client-exposure {}`, `client-exposure {"client":"nestrade"}`, `shipment-status {}`, `shipment-status {"month":"2026/06"}`.
- Sandbox chat: "who am I most short to?" (KONINKLUJKE ~30% of book), "what's booked to ship in June?" (9 booked, 13 unbooked), "which container is the Nestle order in?" (→ accurate decline: not in the export).
- Push `lua push all --force`; user promotes (or `/lua-deploy`). Update SESSION log; commit spec to `docs/superpowers/specs/2026-07-10-client-shipment-analytics-design.md`.
