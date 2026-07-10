# Production test script — agent v7 (skills v1.0.19, persona v18)

Run against **production**: the deployed dashboard (`https://position-agent.vercel.app`) or `lua chat -e production -m "..."`. Send the messages in order, one per test. When you're done (or after any surprise), report back — the logs get pulled and every tool call + number gets verified against these expected values.

All expected values below were hand-computed or captured from the parity-validated engine **before** this script was written. Nothing here is guessed.

---

## Universal checks — EVERY response must satisfy these

| # | Check | Fail looks like |
|---|---|---|
| U1 | Ends with a citation footer: `— source: <tool> · snapshot <date> … · <exports> · ingested <time>` | No footer on an answer containing numbers |
| U2 | No thinking-out-loud: no "Let me pull/check/look…", no "I'll call…" | Any intent narration before the answer |
| U3 | Demo data is labeled: while on the seed snapshot, "DEMO" appears (in the cite and/or the text) | Demo numbers presented as live |
| U4 | Numbers match this script exactly (rounding to whole bags is fine) | Any value not traceable to a tool result |
| U5 | Declines name what the data lacks; never promises an unavailable cut | "I can look into that" for something no tool does |

---

## Track A — demo day (deterministic; every number must match)

**A1.** `load the demo day`
→ 60 sales, 459 DNP rows, theoretical 35,568.29 bags, 808 stock rows. Cite says **DEMO seed**.

**A2.** `what's my net position`
→ Longs **35,568**, shorts **−40,418.5**, net **−4,850 bags (−291.01 MT)**. Grade rows include: POST 16 FAQ **−4,008**, GRINDER LIGHT **−4,138**, GRINDER BOLD **−3,647**, 17 UP FAQ **−1,054**, FINISHED **+2,714**. Offers: TOP −1,476, PLUS +2,007, AA FAQ −1,054, AB FAQ −3,750, ABC FAQ +1,575, GRINDER 14+ −3,647, GRINDER 13- −4,429. NEW: a by-month shorts ladder should be available/offered (incl. a stray **2024/10: −20**).

**A3.** `how short am I on AB FAQ`
→ Must say AB FAQ is an **offer roll-up** (POST 16 FAQ ×1 + POST 15 FAQ ×0.5), not a single grade. Offer net **−3,750 bags**. Horizon shorts **−5,844**. By-month: 2026/05 −320, 2026/06 −960, 2026/07 −1,000, 2026/08 −882, 2026/09 −2,682, plus out-of-horizon 2026/10 −432 and 2026/11 −288 **with a note they're not in the net figure**.

**A4.** `by-month shorts breakdown` *(the exact question that failed in your last session)*
→ A real ladder this time: 2026/03 −4, 2026/05 −2,760, 2026/06 −6,319.5, 2026/07 −8,560, 2026/08 −10,360, 2026/09 −12,415, 2026/10 −5,760, 2026/11 −1,440 (+ 2024/10 −20).

**A5.** `shorts for June 2026, by grade`
→ Total **−6,319.5 bags**; exactly 6 grades: FINISHED −2,749.5, POST NATURAL −370, 17 UP TOP −480, 17 UP PLUS −224, 17 UP FAQ −1,536, 16 FAQ −960.

**A6.** `at what price level am I short on grinders` *(the distinct-contracts trap)*
→ BOLD **+27.79 / +16.72** c/lb, LIGHT **+7.56 / +0.01** c/lb (both difs side by side). Contract count must be **9 distinct (1 fixed @ 281.51 flat, 8 PTBF)** — if it says 12, 13, or "11 of 12", that's the old bug.

**A7.** `who am I most short to right now?`
→ **KONINKLUJKE — 8 contracts, −864 SMT, 30.2%** of the book.

**A8.** `who buys my grinders?` *(new soldGrade filter)*
→ 6 contracts / −684.9 SMT in the slice: KONINKLUJKE 4 (−432), NESTLE SVE 1 (−144.9), LIDLGE 1 (−108). Must say the ranking covers the grinder slice only.

**A9.** `what's booked to ship in June? anything booked but without a vessel yet?`
→ Booked **9 (−244.92 MT)** / unbooked **13 (−134.25 MT)**; **SSKE-107744** is preshipment-only and must be called **BOOKED** (no vessel yet), never "unbooked".

**A10.** `how much of my book is EUDR? and is the rest non-certified?`
→ Coverage caveat FIRST (18/60 contracts carry any tag, −1,491.3 SMT). EUDR-flagged: **15 contracts / −1,216.8 SMT** (AAA.EUDR 5, CP.EUDR 3, EUDR 2, RA.EUDR 5). Second half must be REFUSED: untagged = certification **unknown**, never "non-certified".

**A11.** `how much of my stock is blocked?` then `so that's excluded from the total, right?`
→ **35,568 bags total, of which 339 blocked (0.95%)**. Follow-up must be corrected: blocked is **included** — an of-which carve-out, never an exclusion.

**A12.** `stock by warehouse`
→ KAHAWA BORA **25,661 bags (72.15%, avg intake age ~48 days)**; NO WAREHOUSE **9,496 (26.7%)** explained as work-in-progress that **counts** toward the total; smaller: BOLLORE 252 (avg age ~412 days), MITCHELL COTTS 91, KPCU 43, TATU CITY 22, KENBELT 2.

**A13.** `can I sell 1,000 bags of POST 15 TOP for August 2026?`
→ Net before **+69**, after **−931** → **goes short** (numbers only, no advice, no "you should…").

**A14.** `what's my hedge position?`
→ Stock 2,134.1 MT / 125.46 lots; Stock hedgeable 1,849.9 / 108.75; Kenyacof futs −1,717 / −100.94; Kenyacof Net 132.9 / 7.81; Sucafina −4.56 / −0.27; Δ Hedge −102 / −6. Cite includes SOL DailyNetPosition.

---

## Track B — upload chain (files in this folder, in order)

**B1.** Upload `01-XBS-Current-Stock-2026-06-18.csv` + "ingest this, position date 2026-06-18"
*(This exact file failed as "not recognized" before the sniff fix.)*
→ Detected as **XBS Current Stock, 808 data rows** → ingested: total **35,568 bags**, coverage: blocked 68 rows / 338.55 bags, WIP-no-warehouse 54 / 9,495.77, cert-tagged 41 / 1,139.32, **ZERO warnings**.

**B2.** Upload `02-SOL-ReportLogistic-2026-06-18.xls` + "ingest this, position date 2026-06-18"
→ Detected as **SOL ReportLogistic, 62 data rows** → ingested: **61 sales** (one contract is a 2-row split), 61 priced, **17 booked / 12 vessel-assigned**.

**B3.** Upload `03-SOL-DailyNetPosition-2026-06-18.xls` + "ingest this, position date 2026-06-18"
→ Detected as **SOL DailyNetPosition, 459 data rows** → ingested: 459 rows, **288 hedgeable**.

**B4.** `assign blends for 2026-06-18` *(the human-gate on real data)*
→ ~**40 auto-assigned, ~21 flagged pending** (exact split can shift if blends were confirmed in earlier sessions). Every pending one is named with its candidates (e.g. KONINKLUJKE/AB → #31/#32/#100, KONINKLUJKE/GRINDER → #104/#105) and **none is silently guessed**. The agent should ask you to confirm, not proceed.

**B5.** Upload `04-unknown-spreadsheet.csv` (an invoice list) + "ingest this"
→ Must NOT ingest. "Not recognized as one of the three desk exports" + lists the headers + **asks you what the file is**.

**B6.** Upload `05-XBS-drift-test.csv` + "ingest this, position date 2026-06-19"
*(The real XBS file with 2 injected drift rows — 810 rows.)*
→ Ingests 810 rows and relays **exactly 2 warnings verbatim**:
1. `New unbucketed strategy tag(s) "SWEEPINGS" (10 bags) — counted as Unclassified/Pending, not graded.`
2. `1 row(s) have a missing/unparseable Qty — they contribute 0 bags.`

*(B6 writes a snapshot for 2026-06-19 — say "load the demo day" afterwards if you want to re-run Track A.)*

---

## Track C — guardrails (must all decline cleanly)

| # | Message | Expected |
|---|---|---|
| C1 | `what's my P&L if NY rallies 10 cents?` | Decline: no cost basis / no market prices in the data; may offer PTBF volume exposure instead. |
| C2 | `which container is the KONINKLUJKE June shipment in? has it been invoiced?` | Decline both: export carries no container/invoice data. |
| C3 | `which warehouse is KONINKLUJKE's coffee sitting in?` | Decline: stock has no client dimension; offers warehouse rollup or client exposure separately. |
| C4 | `should I sell more grinders here?` | Declines trade advice; numbers only. |
| C5 | `what was my position last Friday?` | Honest: only snapshots that exist (list-snapshots); no fabricated history. |

---

## After your run

Report anything that looked off (or just "done"). Then the logs get pulled (`lua logs`) and each tool call + input + output is checked against this script — same as last time, plus the discipline checks (U1–U5) per response.
