# QA Triage — Round 3: prior-finding fixes + re-upload/file-change edge cases

- **Date:** 2026-07-13
- **Environment:** SANDBOX (locally compiled code pushed to sandbox on each `lua chat -e sandbox`). `lua sync --check` was verified CLEAN (exit 0) after reconciling the agent name, *before* this round's code edits; the edits below re-introduce expected skill drift until pushed.
- **Production snapshot under test:** 2026-07-10 (staleness banner active, 21 pending blend confirmations — both expected).
- **New harness:** `src/__tests__/upload.ts` — 17 re-upload edge cases on synthetic/mocked inputs (in-memory `Data` fake; no CDN, no network, no writes to the live store). Run: `npx tsx src/__tests__/upload.ts`.

## 1. Prior findings — verification status

### QA-F1 (deploy/sync integrity) — RESOLVED
`lua sync --accept` took the server name (`Position_Assistant`) into local config; `lua sync --check` now exits 0 with no drift anywhere. Note: skills were already in sync with the server, so the previous pass's drift was *only* ever the name field.

### QA-F2 (spurious resolvedFrom on exact grade name) — FIXED, VERIFIED
The reworded `grade` `.describe()` strings ("passed EXACTLY as the trader typed it — never strip or add the POST prefix") were verified in sandbox:
- Thread `qa-f2-exact-1783897325`: "What's my exposure to POST 16 FAQ?" → logs show `Calling tool with input {"grade":"POST 16 FAQ"}`, tool result has **no `resolvedFrom`**, answer opens with no resolution claim.
- Thread `qa-f2-fuzzy-1783897371` (control): "…exposure to 16 FAQ?" → fuzzy path still works, answer correctly opens `"16 faq" → **POST 16 FAQ**`.

### QA-F3 (turn-2 cite derivation wrong for hedge/futs fields) — FIXED, VERIFIED
The derivation clause is now context-aware: when hedge/futs lines are surfaced it appends a hedge-specific clause describing the pot arithmetic instead of only the grade-net formula.
- Code: `src/skills/query.skill.ts` (new `HEDGE_DERIVATION` const, full-position branch) and `src/skills/pipeline.ts` (compute-position cite). `src/lib/cite.ts` unchanged (pure relay).
- Verified in thread `qa-f3-hedge-r3`: turn 2 ("is my Kenyacof hedge line looking safe?") cites `…; hedge: Kenyacof Net = Stock hedgeable + Kenyacof futs (manual) + KenyaZZ (manual); Sucafina = SOL DailyNetPosition futures rows; Δ Hedge (KENY_AR_DYN) = manual pot input`. Trade-advice ban held on the same turn.
- Parity harness (incl. section [15] citation) fully green after the edit.

### QA-F4 (banner glued to decline sentence) — FIXED, VERIFIED
Persona hard rule 6 tightened (`src/index.ts`): "The ⚠️ character is ALWAYS the first character of the whole answer AND of its own paragraph… never append the banner to the end of a sentence."
- Verified in `qa-f3-hedge-r3` (stale context in-thread): trade-advice decline now opens with the banner on its own paragraph, decline follows in a new paragraph.
- Note: a decline in a *fresh* thread with no tool call (`qa-f4-decline-r3`) carries no banner — correct, since no `staleNotice` exists in that thread.

### Production spot-check — PASSED
Full-position tool result in `qa-f3-hedge-r3` matches the known production figures exactly: net **+6,967.94 bags**, longs **24,803.94**, shorts **−17,836**. (An apparent AB FAQ mix-up was investigated and is NOT a bug: the AB FAQ *offer* on 2026-07-10 genuinely equals −2,316.4 bags / −138.98 MT per the tool's offers block.)

## 2. Re-upload edge-case suite — results (17/17 sections pass)

| # | Case | Result |
|---|------|--------|
| 1 | Same kind+date uploaded twice | ✅ one input doc, payload clean, no duplicates |
| 2 | Re-upload 1 of 3 kinds | ✅ other two untouched (regression check for the 2026-07-10 incident) |
| 3 | All 6 upload orderings | ✅ identical final snapshot |
| 4 | Rows disagree on date | ✅ majority (3/4) wins + verbatim disagreement warning |
| 5 | Provided date conflicts with derived | ✅ export date wins + conflict warning relayed |
| 6 | Logistics with NO date | ✅ refuses ("never assume it is today's"), nothing persisted |
| 7 | Logistics WITH date | ✅ `dateSource: trader-provided (no date derivable from the export rows)` |
| 8 | TRUE concurrency (3 parallel ingests) | ✅ deterministic barrier: legacy single-doc design duplicates (control proves the harness catches the old bug); current per-kind design loses nothing; 25 fuzzed runs clean |
| 9 | Future-dated export | ✅ characterized → **FINDING R3-F2** |
| 10 | Empty files | ✅ XBS/DNP refuse cleanly; empty logistics → **FINDING R3-F1** |
| 11 | Wrong/malformed file | ✅ clean `Column not found:` / "does not look like an XBS stock report" errors, no crash |
| 12 | delete-snapshot then re-upload | ✅ pendings purged, date starts fresh; manual inputs survive → **FINDING R3-F4** |
| 13 | Manual pots survive re-ingest | ✅ byte-identical; compute applies Kenyacof futs −1717 MT |
| 14 | Sales re-upload changing pending set | ✅ snapshot + compute result refresh correctly; collection keeps ghosts → **FINDING R3-F3** |
| 15 | Legacy duplicate docs | ✅ computed docs: newest-wins (mergeDocs); input docs: insertion-order → **FINDING R3-F5** |
| 16 | Unicode client/grade names | ✅ survive utf-8 and utf-16le+BOM decode → parse → store → citeLine |
| 17 | Double-submit idempotency | ✅ figures, doc counts, pending counts identical |

## 3. New findings (from the suite — all pre-existing behavior, none introduced this round)

### R3-F1 (medium-high) — empty ReportLogistic silently wipes the sales book
An empty (0 data rows) logistics upload with a positionDate ingests `sales: []` without protest; a corrupt/truncated re-upload would replace a good sales book with nothing and every downstream figure would quietly lose its shorts.
**Owner:** lua-skill-builder. **Action:** zero-row guard in `ingest-logistics-report` (refuse or demand explicit confirmation when `sales.length === 0`, especially when a non-empty sales input doc already exists for that date). Consider the same guard for XBS/DNP (currently protected only indirectly by the date refusal).

### R3-F2 (low) — future-dated exports accepted silently
`resolvePositionDate` has no future-date sanity check; a 2027 DatePos ingests verbatim and, because `snapshotAgeDays` < 1, the staleness banner will *never* flag it — it permanently looks "current".
**Owner:** lua-skill-builder. **Action:** warn (not block) when derived/provided date > today (Nairobi).

### R3-F3 (medium) — stale `pending_blends` docs survive a sales re-upload
`pipeline.ts` (and `forwardsales.skill.ts`) upsert pendings for the current book but never delete docs for sales that left it. The snapshot's `pendingBlends` key and compute results are correct; the collection keeps ghosts until `confirm-blend`/`delete-snapshot`. Any consumer reading the collection directly (e.g. a future dashboard) shows resolved sales as pending.
**Owner:** lua-skill-builder. **Action:** after computing pendings, delete `pending_blends` docs for (positionDate, saleCtr) pairs not in the current pending set.

### R3-F4 (low — semantics question for the desk) — `delete-snapshot` keeps `manual_inputs`
Deleting a date removes snapshot + inputs + pendings but leaves the manual hedge pots; re-uploading that date silently inherits the old Kenyacof futs / Δ Hedge figures.
**Owner:** desk decision, then lua-skill-builder. **Action:** confirm intended; either delete them too or state the inheritance in the tool's response.

### R3-F5 (low) — duplicate `snapshot_inputs` resolve by insertion order, not updatedAt
`getSnapshot` assigns `data[kind]` per input doc in `getAll` order; unlike `mergeDocs` (computed docs, updatedAt-sorted), which payload wins for pre-fix duplicate input docs is storage-order luck. Only matters if pre-fix duplicates exist in prod.
**Owner:** lua-debug. **Action:** sort input docs by `updatedAt` in `getSnapshot` (one-line), or verify prod has no duplicate (positionDate, kind) docs and note it.

## 4. Ship status

Per the desk's instruction this round STOPS at verified-in-sandbox. **Not pushed / not deployed.** Working-tree changes pending a push decision:
- `src/skills/query.skill.ts`, `src/skills/pipeline.ts` — QA-F3 hedge derivation clause
- `src/index.ts` — QA-F4 persona rule 6 tightening (+ agent name accepted from server)
- `src/__tests__/upload.ts` — new harness (test-only, not a deployed primitive)
- plus the pre-existing uncommitted QA-round-2 changes (QA-F2 describe strings, staleNotice plumbing, insights)

Log scan at close: 0 `error`/`warn` entries in the recent agent log window.
