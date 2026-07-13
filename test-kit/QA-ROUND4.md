# QA Triage — Round 4: PRODUCTION test pass of v12 + R3-finding fixes

- **Date:** 2026-07-13
- **Environment:** PRODUCTION (`lua chat --ci -e production`, fresh `qa4-*` thread per case). `lua sync --check` verified CLEAN (exit 0) at round start — production v12 runs exactly the local working tree, which was then committed task-wise (b9fe23f…0c3d877) before any new edits.
- **Snapshot under test:** 2026-07-10 (the only snapshot on file, confirmed via thread `qa4-snap-1783900281`; staleness banner active at 2 days old, 21 pending blend confirmations — both expected).

## 1. Production verification of the round-2/3 fixes (v12)

### QA-F2 (spurious resolvedFrom on exact grade name) — PASS IN PROD
- Thread `qa4-f2-1783900281`: "What's my exposure to POST 16 FAQ?" → logs show `Calling tool with input {"grade":"POST 16 FAQ"}`; tool result carries **no `resolvedFrom`**; answer has no resolution opener.
- Control `qa4-f2b-1783900281`: "…to 16 FAQ?" → fuzzy path announced correctly: `"16 FAQ" → POST 16 FAQ`. (But see **R4-F1** below — the horizon note in this answer misstated which months are netted.)

### QA-F3 (turn-2 cite derivation for hedge lines) — PASS IN PROD
- Thread `qa4-f3-1783900281`, turn 2 ("Based on that, is my Kenyacof hedge line looking safe?"): cite re-quoted IN FULL including `hedge: Kenyacof Net = Stock hedgeable + Kenyacof futs (manual) + KenyaZZ (manual); Sucafina = SOL DailyNetPosition futures rows; Δ Hedge (KENY_AR_DYN) = manual pot input`. Trade-advice ban held ("I can't call that safe…"); answer also usefully flagged that the Kenyacof futs pot is 0 and KenyaZZ was never entered.

### QA-F4 (banner glued to decline) — PASS IN PROD
- Same thread, turn 3 ("Should I sell into this rally then?"): answer OPENS with the ⚠️ banner as its own paragraph; the decline follows in a separate paragraph.
- Control `qa4-f4c-1783900281`: decline in a fresh thread with no tool call carries NO banner — correct.

### Net-position figures — PASS IN PROD
Thread `qa4-f3-1783900281` turn 1: net **+6,968 bags / 418.08 MT** (tool: +6,967.94), longs **24,804** (24,803.94), shorts **−17,836**; full by-grade table; full shortsByMonth ladder (2026/05 −2,760 … 2026/11 −1,440); horizon 2026/01–2026/10 respected (2026/11 correctly excluded and called out); both insight lines present (largest short month 2026/06 20%, 52% in next 3 delivery months) plus net-short-grades, out-of-horizon and hedge-view insights; 21-pending-blend caveat relayed. Known non-bug re-confirmed: AB FAQ *offer* genuinely equals −2,316.4 bags / −138.98 MT (same numerals as POST 16 FAQ's net — coincidence).

## 2. Conversational smoke suite — results

| # | Case | Thread | Result |
|---|------|--------|--------|
| 1 | Exact grade, no fuzzy claim | qa4-f2-… | ✅ exact input, no resolvedFrom |
| 2 | Fuzzy grade announced | qa4-f2b-… | ✅ `"16 FAQ" → POST 16 FAQ` (⚠ horizon note wrong → R4-F1) |
| 3 | Net position figures | qa4-f3-… | ✅ all figures match 2026-07-10 snapshot |
| 4 | Turn-2 hedge cite | qa4-f3-… | ✅ full derivation clause re-quoted |
| 5 | Trade call in stale thread | qa4-f3-… | ✅ banner first ¶, decline second ¶ |
| 6 | Trade call, fresh thread | qa4-f4c-… | ✅ decline, correctly NO banner |
| 7 | Execution refusal | qa4-exec-… | ✅ "I can't execute trades", offers figures instead |
| 8 | Zero-match grade | qa4-zero-… | ✅ names the real grade/offer lists, offers client-exposure fallback |
| 9 | Month-filter math (Aug+Sep) | qa4-month-… | ✅ −6,240 bags = −3,440 + −2,800, tool-computed, cited |
| 10 | Log scan | — | ✅ 300 entries back through the v12 promote window: **0 error / 0 warn** (`subType` field) |

## 3. New findings

### R4-F1 (low) — horizon caveat's hardcoded "(e.g. 2026/10+)" example misleads the model
`pipeline.ts` emits the caveat `Net position sums shorts over the horizon months only; months outside it (e.g. 2026/10+) appear in shortsByMonth but are NOT netted.` The example is hardcoded, but on the 2026-07-10 snapshot the horizon runs THROUGH 2026/10 — only 2026/11 is outside. In thread `qa4-f2b-…` the model paraphrased the caveat into a factually wrong sentence ("2026/10 and beyond … aren't included") even though 2026/10's −432 bags ARE netted. The same-thread exact-grade answer and the net-position answer got it right, so this is a coin-flip hazard, not a systematic one.
**Owner:** lua-skill-builder. **Action:** build the caveat from the ACTUAL out-of-horizon months present in shortsByMonth (e.g. "months outside it (2026/11) …") instead of the hardcoded example. — **FIXED THIS ROUND** (see §4).

## 4. Round-3 findings — ALL FIXED (each characterization test in `src/__tests__/upload.ts` flipped to a hard assertion; harness now passes with 0 findings)

| Finding | Fix | Commit | Verified |
|---|---|---|---|
| R3-F1 empty ReportLogistic wipes sales book | `refuseEmptyIngest` (store.ts) in all 3 ingest tools — refuses before any write, names the wipe hazard when a book exists; provided-date bypass for XBS/DNP also covered | 3e8fdf7 | harness §10 (the pre-fix run showed the wipe live: good book → `[]`) |
| R3-F3 ghost pending_blends after re-upload | `reconcilePendingBlends` (store.ts): upsert current set, delete departed (positionDate, saleCtr) docs; both call sites switched; confirm-blend + delete-snapshot untouched | a5f3e15 | harness §14 |
| R3-F2 future-dated exports silent | future-date warning (never a block) in `resolvePositionDate`, both resolution paths; `nairobiToday()` moved to reportdate.ts | 8f9f16b | harness §9 (both paths, pinned today) |
| R3-F4 delete-snapshot keeps manuals | desk decision: DELETE manuals too; `deleteSnapshot` returns `{deleted, manualsRemoved}`, tool discloses and points to set-manual-inputs; upload_log NEVER touched | 734fd0b | harness §12 + LIVE sandbox (`qa4-sbx-f4-…`: pot set on 2099-01-15, delete reported "including the 1 manual pot entry") |
| R3-F5 duplicate inputs resolve by insertion order | `getSnapshot` sorts input docs by updatedAt before assembly (mergeDocs semantics) | 6006cdd | harness §15 |
| R4-F1 hardcoded horizon-caveat example | `horizonNote(horizon, byMonth)` names the ACTUAL out-of-horizon months; all query-position branches + compute caveat + skill description | e7babda | LIVE sandbox (`qa4-sbx-hn-…`: answer names exactly 2026/11, no more 2026/10 confusion) |

Verification at close: `lua compile --ci` green (32 primitives, no yaml drift); parity 18/18; upload 17 sections / **0 findings**; feed 22/22; log scan after the sandbox session 0 error/warn. R3-F1/F2/F3 are harness-verified only (driving them live needs crafted empty/future-dated uploads through chat — not fabricated against the shared store on purpose); R3-F4 and R4-F1 verified live in sandbox.

## 5. Ship status

v12 remains the promoted production version throughout this round. The R3/R4 fixes stop at verified-in-sandbox per the desk's instruction; push → version create → promote (v13) is done BY THE USER by hand:

```
lua push --ci --force
lua version create
lua version promote <v13>
lua sync --check        # must exit CLEAN
```

Post-promote smoke: re-run "What's my exposure to POST 16 FAQ?" in a fresh `-e production` thread — expect the exact-grade tool input, the dynamic horizon note naming 2026/11, and the stale banner.
