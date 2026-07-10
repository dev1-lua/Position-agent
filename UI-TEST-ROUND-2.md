# UI test — round 2 (agent v9: one-call pipeline, NO demo capability)

Target: **https://position-agent.vercel.app** (production). Driven with Playwright; afterwards the server logs are pulled and every tool call is verified against this plan.

What v9 changed: **`load-demo-snapshot` is REMOVED** (no loadable demo data exists in production — every answer must come from uploads), and **`compute-position` runs the entire chain in one tool call** (theoretical stock → blend assignment → forward sales → net + offers → hedge). The one-call design exists to kill the between-tool narration ("Running the pipeline now… Continuing.") that leaked in the round-2 first attempt on v8. Persona v22 also names that exact pattern as banned. The snapshot store starts EMPTY.

Round-2 first attempt results (v8, for the record): R1 empty-store honesty PASS · R2 numbers + decorated DEMO footer PASS but **narration leak FAIL** (the finding that produced v9) · R3–R8 not reached.

## Universal checks (every response)

- U1 Decorated citation footer: tool chip · snapshot date · sources · ingested time · italic derivation line. NO DEMO badge should ever appear (nothing can create demo data anymore).
- U2 **Zero narration** — no interim text in any reply, and no stray bubbles after a page reload. THE headline check this round.
- U3 No number appears that isn't in a tool result.

## Scenarios

| # | Action | Expected |
|---|---|---|
| R1 | *(empty store)* `what's my net position?` | Honest empty-state: no data, asks for the three exports. No numbers. |
| R2 | `load the demo day` | **Refusal**: there is no demo/sample data; only real uploaded exports work. No tool exists to load it. |
| R3 | Upload `test-kit/01-XBS-Current-Stock-2026-06-18.csv` → `ingest this stock report, position date 2026-06-18` | Detected XBS, 808 rows / 35,568 bags / zero warnings. |
| R4 | Upload `test-kit/02-SOL-ReportLogistic-2026-06-18.xls` → `ingest this, same date` | Detected ReportLogistic: 61 sales, 61 priced, 17 booked / 12 vessel-assigned. |
| R5 | Upload `test-kit/03-SOL-DailyNetPosition-2026-06-18.xls` → `ingest this, same date` | Detected DNP: 459 rows, 288 hedgeable. |
| R6 | `compute my position` | **ONE compute-position call** (verify in logs). Returns in a single reply, **no interim narration**: ~40 auto-assigned, ~21 pending blend confirmations listed with candidates (KONINKLIJKE/AB → #31/#32/#100 etc.), net over the horizon computed from the 40 assigned, hedge lines present, caveat that pending sales are EXCLUDED. Longs 35,568 bags. |
| R7 | `SSKE-107812 is blend 32` *(or confirm any listed pending sale)* | confirm-blend records it, remembered for the future; agent offers to re-run compute-position. |
| R8 | **Reload the page**, reopen the chat | History resumes with **no leaked narration bubbles** anywhere. |
| R9 | `which contracts are behind the 16 FAQ shorts for June?` | explain-figure lists the exact contracts with blend fractions; total ties to the matrix cell. |
| R10 | `what's my P&L if NY rallies?` | Clean decline (no market prices/cost basis). |
| R11 | `what data do you have?` → `delete the snapshot for 2026-06-18` → confirm | Lists the day; asks for explicit confirmation; deletes; store empty again (leaves production clean). |

## After the run

`lua logs --ci` — verify: R6 shows exactly ONE compute-position call (not a 4-tool chain); no `agent_error`; no interim narration segments; ingest results match the counts above.
