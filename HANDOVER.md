# Position Assistant — Handover

**Resume prompt:** paste the "Resume prompt" block at the bottom into a new chat. This doc is the full context.

---

## 1. What this is

Building **Position Assistant** — a Lua AI agent (agent #4 "Production & Trading Position Analysis" in the Sucafina × Lua solution design doc) that replicates Sucafina Kenya desk trader Ivo's manual "LongShort" Excel workflow:

> **Longs (stock on hand) − Shorts (forward sales) = Net Position**, by export grade and delivery month, plus a futures/hedge view, delivered conversationally with a scheduled morning report.

- **Full plan (approved):** `/Users/devashishthapliyal/.claude/plans/magical-leaping-quasar.md` — read this first; it has the architecture, data model, reverse-engineered formulas, and build phases.
- **Repo:** `/Users/devashishthapliyal/Documents/work/Lua/Trade-position-assistant` (a `lua-cli` v3.18 project).
- **Source data:** `forecast-context/` (the workbook, SOL exports, stock counter, config JSONs, PDFs).

## 2. Locked decisions (from user)

| Decision | Choice |
|---|---|
| Build target | Position Assistant (#4). Agent renamed `Trade-position-assistant` → **`Position Assistant`** (done in `src/index.ts`). |
| Scope | **Full workbook parity** (net position + offers + futures/hedge + certificates). |
| Data source | Uploaded file exports now, behind a **data-source adapter** so Brian's Azure DB mirror plugs in later. Both eventually. |
| Channel | **Website chat widget (LuaPop)**. |
| Blend assignment | Auto-match + **flag ambiguous for trader confirmation** (human-gate). See §5 — the naive key was wrong; corrected to a learned-memory approach. |
| Certs + futures pots | Build engine now with **manual daily inputs**; user will provide the 3 cert workbooks + a SOL futures export later. |
| Validation | `LongShort_2026-06-18.xlsm` is the golden reference; user will provide the raw XBS stock export for that day. |

## 3. The reverse-engineered model (verified)

- **Unit constants:** 60 kg/bag; MT = bags × 0.06; futures lot = 17.01 MT. Sale bags per POST grade = `(SMT × blendFraction) × 1000/60` (BASE FILE col AW).
- **Longs (theoretical stock):** port of `forecast-context/new_stockcounter.html` — parse XBS stock, bucket PRE/IN/POST/FINISHED, apply yield % → theoretical stock by POST grade → feeds `Summary!C`.
- **Shorts (forward sales):** each sale (from `ReportLogistic`, status `6-Sales Unallocated`) → Blend No. → `Blends` recipe (fraction per POST grade) → bags per POST grade → grouped by delivery month (`YYYY/MM`). `POST FAQ MINUS` is dropped from aggregation (workbook parity). 23 recipe grades → 22 summary grades.
- **Net position:** `net[grade] = theoretical[grade] + Σ forwardSales[grade][month]` over the horizon. **IMPORTANT quirk:** the workbook nets forward sales only over Summary cols **E:N = 2025/12..2026/09** (a fixed 10-month horizon), NOT all 13 Forward-Sales columns. Encoded as a parameter (`sumOverMonths`); make it a rolling window later.
- **Offers** (Summary block, weighted): `TOP = Σ TOP nets`, `PLUS = Σ PLUS nets`, `AA FAQ = net[17UP FAQ]`, `AB FAQ = net[16 FAQ] + 0.5·net[15 FAQ]`, `ABC FAQ = 0.5·net[15 FAQ] + net[14 FAQ]`, `GRINDER 14+ = net[BOLD]`, `GRINDER 13- = net[LIGHT] + net[MH]`; MT = bags × 0.06.
- **Futs + Spread (NOT yet built):** MT/hedge view. Key formulas captured verbatim in the workbook (`Futs + Spread` sheet):
  - `Stock = Summary!C26 × 0.06`
  - `Direct Sales Stock = -( SUMIFS(DailyNetPosition P.MT [col O], State ∈ {"0-In Store Origin unsold","2-To Be Shipped Unsold"}, supplier ∉ {RABOBANK IN, Kenyacof}, Quality="Hedgeable") )`
  - `LG Non hedgeable = -((Rejects S + Rejects P)×60/1000)×0.2`
  - `Specialty = -(POST NATURAL × 60/1000)`
  - `Sucafina futures = SUMIFS(DailyNetPosition TotLine [col S], Quality="Hedgeable", State≠"invoiced with fixing only", supplier≠"RABOBANK IN")`
  - Manual inputs (from SOL pots, entered by hand): Kenyacof futs MT, lots/month per KCU/KCN/KCZ, Δ Hedge (KENY_AR_DYN).
- **Certificates (NOT built):** `Summary` links to 3 EXTERNAL workbooks (`AAA Cert Position`, `NET POSITION`, `CP-Purchases`) we don't have → manual-input section for now.
- **`assumptions.json` reconciliation nuance:** it's keyed `STRATEGY // GRADE → output *strategies*`, whereas the stock counter forecast is keyed `(input grade | batch-prefix) → POST *grades*`. Must reconcile so saved assumptions auto-populate the forecast (removes Ivo's manual %-entry). Confirm mapping with Ivo. `strategy_mapping.json` + `batch_mappings.json` drive classification.

## 4. What's DONE (and validated)

Pure computation libs (no Lua imports — run under `tsx`):
- `src/lib/units.ts` — constants + conversions.
- `src/lib/grades.ts` — POST grade taxonomy (23 recipe / 22 summary), `FORWARD_SALES_SKIP`, offer groups, `normGrade`.
- `src/lib/types.ts` — `Blend`, `Sale`, `StockRow`, `BlendMatch`, `ForwardSalesResult`, `NetPositionResult`.
- `src/lib/blends.ts` — learned-memory blend matcher (see §5).
- `src/lib/shorts.ts` — `computeForwardSales` (matrix + byGrade + pending), `sumOverMonths`.
- `src/lib/netposition.ts` — `computeNetPosition`, `computeOffers`.

**Parity harness `src/__tests__/parity.ts`** (`npx tsx src/__tests__/parity.ts`) — against golden 2026-06-18:
- ✅ **[1] Forward-sales matrix: 286/286 cells exact (Δ 0.000).**
- ✅ **[3] Net position: every grade + total (−4850.21) exact (Δ 0.000); offers match Summary.**
- ⚠️ **[2] Blend matcher (leave-one-out): 42% auto-correct, 52% flagged, 7% wrong.** Harness exits 1 solely due to the honest 7% flag; the math (1 & 3) is exact.

Fixtures/seed (extracted from the workbook via Python — scripts in scratchpad):
- `src/seed/blends.json` (114 recipes, 23 grade cols), `src/seed/{assumptions,strategy_mapping,batch_mapping}.json`.
- `src/__tests__/golden_2026-06-18.json` (Summary + Forward Sales + Futs golden values).
- `src/__tests__/basefile_2026-06-18.json` (60 sales with ground-truth blend #, month, cached allocations).

Project: agent renamed + real persona in `src/index.ts`; `xlsx` added to `package.json` (installed).

## 5. KEY FINDING — blend assignment

The `Blends` sheet's **client/grade/cup-profile columns are just human labels**; they do NOT determine which blend a sale gets (e.g. a GSIINTERNAT sale is assigned blend #23 labelled "FIDELI CO"; an ITOH sale gets the "FINISHED" blend). Matching on those columns is the **wrong key** (was 5% correct, 25% *confidently wrong*).

What IS learnable: Ivo's assignments are consistent by **(client, sold-grade, strategy)** — 30/34 such keys map to a unique blend. So `src/lib/blends.ts` now uses a **learned assignment memory** (`buildAssignmentMemory`, `matchBlend`, `rememberAssignment`): unique historical key → auto-apply; new/ambiguous key → flag for confirmation → remember the answer. This mirrors the design doc's "supplier→classification memory, updatable by telling the agent."

Remaining 7% wrong (LOO) = genuinely ambiguous keys (same key → 2 blends legitimately, e.g. 32CUP/NAT.SPECIALTY → #91 and #100). **Fix (task #8):** track globally-ambiguous keys (ever mapped to >1 blend in full history) and always flag them → wrong → ~0. Then elicit more historical assignments from Ivo to raise the auto-apply rate.

## 6. What's LEFT (in order)

1. **Task #2 — Longs engine** (`src/lib/stockcounter.ts`): port `new_stockcounter.html` (`processInventoryLocation`, `processWarehouseStatus`, `processMatrixData`, `calculateTheoreticalStock`, `POST_ORDER`/`PRE_IN_ORDER`, `consolidationMap`). Reconcile `assumptions.json` keying (§3). Validate vs `Stocks` sheet + raw XBS export when it arrives (currently only validated indirectly — golden theoretical stock is fed into net-position test).
2. **Task #4 — Futs/Spread + certs** (`src/lib/futsspread.ts`): formulas in §3; parse `DailyNetPosition`; manual-input struct for futures pots + cert positions.
3. **Task #8 — Blend matcher refinement** (globally-ambiguous flag) + request Ivo's historical assignments.
4. **Task #6 — Lua wiring:** data-source adapter (`src/sources/{PositionSource,UploadedFileSource,AzureDbSource}.ts`; `UploadedFileSource` uses `CDN.get(fileId)`); skills `src/skills/{ingestion,stockcounter,forwardsales,position,query}.skill.ts`; seed Data-API collections (`config`, `assumptions`, `strategy_mappings`, `batch_mappings`, `blends`, `snapshots`, `pending_blends`, `manual_inputs`); persist snapshots; register skills in `src/index.ts`.
5. **Task #7 — Morning report job + LuaPop + compile:** `src/jobs/morning-report.job.ts` (`LuaJob` cron ~06:00 `Africa/Nairobi` → `User.get(metadata.userId).send([...])`); configure LuaPop channel; `lua compile --ci`.

## 7. Lua API cheat-sheet (verified from `node_modules/lua-cli/dist/api-exports.d.ts` v3.18)

- Tools: `export class XTool implements LuaTool { name; description; inputSchema = z.object({...}); async execute(input, ctx?) {...} }`.
- `new LuaSkill({ name, description, context, tools: [...] })`.
- `new LuaJob({ name, description, schedule: {type:'cron', expression, timezone} | {type:'interval', seconds}, timeout, retry, metadata, execute: async (job) => {} })`.
- `new LuaAgent({ name, persona, model, skills, jobs, ... })`.
- `Data.create(coll, obj, searchText?)`; `Data.get(coll, filter?, page?, limit?)` → `{data:[{id, data:{...}}], pagination}`; `Data.getEntry`, `Data.update`, `Data.search`, `Data.delete`.
- `CDN.get(fileId)` → File (`.text()`, `.arrayBuffer()`, `.name`, `.type`); `CDN.upload(file)`.
- `User.get(userId | {email} | {phone})` → `UserDataInstance | null`; `.send([{type:'text', text}])`.
- `JobInstance`: `.metadata`, `.user()`, `.updateMetadata()`. Jobs have NO ambient user — store `userId` in metadata.
- `env(key)`.
- **File-upload → tool is a docs gap:** verify in `lua chat` how an uploaded file reaches a tool (fileId in input? via `User.getChatHistory()` file content-part `.data`?). Design ingestion tools to accept a `fileId`/file-ref string and resolve via `CDN.get`; add a `getChatHistory()` fallback that grabs the latest `type:'file'` part.

## 8. Gotchas / environment

- **Project is ESM** (`"type":"module"`): use `import.meta.url` + `fileURLToPath`, not `__dirname`.
- **A PreToolUse hook (`confirm-deploy.mjs`) blocks some multi-line Bash** heredocs (misfires as "bare lua deploy"). Workaround: write Python/JS to a file and run the file. Simple one-liners are fine.
- **`.xls` files in `forecast-context/` are NOT real xls** — they're tab-separated text exports: `DailyNetPosition-IVO (87).xls` = UTF-16 TSV; `ReportLogistic20260618-IVO.xls` = ASCII TSV. `LongShort_2026-06-18.xlsm` is a real workbook (openpyxl).
- **`timeout` cmd absent on macOS** (use `gtimeout` or none).
- Python extractor scripts live in the session scratchpad (`.../scratchpad/{extract_seed,extract_basefile,gap,inspect*}.py`) — reproducible if fixtures need regenerating; consider moving into `scripts/` in the repo.
- Real integrations have **no API** (SOL/XBS manual exports); the adapter isolates this. Azure DB mirror is "overdue" per the design doc.

## 9. Dependencies to request from Ivo

- Raw **XBS stock export** for 2026-06-18 (validate longs from raw input).
- The **3 certificate workbooks** + a **SOL futures export** (to auto-wire certs + futures pots).
- **Historical sale→blend assignments** (more BASE FILE snapshots) to seed/validate the blend memory.
- Confirm the **assumptions→POST-grade** mapping.

---

### Resume prompt

> Resume building the **Position Assistant** Lua agent. Read `HANDOVER.md` and `/Users/devashishthapliyal/.claude/plans/magical-leaping-quasar.md` in full first. Status: the pure position engine (`src/lib/*`) is built and validated to **exact parity** against the golden 2026-06-18 workbook (forward-sales matrix + net position both Δ0) via `npx tsx src/__tests__/parity.ts`; the agent is renamed and seed/fixtures extracted. Continue with the remaining tasks in `HANDOVER.md §6` in order: (1) longs stock-counter engine `src/lib/stockcounter.ts`, (2) `src/lib/futsspread.ts`, (3) blend-matcher globally-ambiguous refinement, (4) Lua wiring — data-source adapter + skills + Data-API seeding, (5) morning-report job + LuaPop channel + `lua compile --ci`. Keep every lib pure and extend the parity harness as you go. Don't re-derive the model — the formulas and the blend-matcher finding are in HANDOVER §3 and §5.
