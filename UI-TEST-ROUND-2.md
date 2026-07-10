# UI test — round 2 (agent v8, dashboard citation footer)

Target: **https://position-agent.vercel.app** (production, agent v8 = 31 primitives, persona v21). Driven with Playwright; afterwards the server logs are pulled and every tool call is verified against this plan.

What v8 changed vs the round-1 test: derivation clause in every cite, `explain-figure` drill-down, demo isolation (real upload CLEARS a demo date), `delete-snapshot`, the pre-tool narration ban (persona v21), and the decorated citation footer in the dashboard. **The snapshot store starts EMPTY** (all test days were purged), which round 1 never covered.

## Universal checks (every response)

- U1 Citation footer is DECORATED: tool chip · snapshot date · sources · ingested time, plus an italic derivation line (source columns + formula). Amber **DEMO DATA** badge on demo answers only.
- U2 Zero intent narration — including NO stray bubbles after a page reload (round 1 found leaked pre-tool text on history resume; persona v21 bans it).
- U3 No number appears that isn't in a tool result.

## Scenarios

| # | Action | Expected |
|---|---|---|
| R1 | *(empty store)* `what's my net position?` | Honest empty-state: no snapshot exists, asks for the three exports (or offers the demo day). NO numbers, NO hallucinated position. |
| R2 | `load the demo day` | Pipeline runs: net **−4,850 bags**, offers table exact (TOP −1,476 … GRINDER 13- −4,429). Footer: chip + **DEMO DATA** badge + derivation line (`net[grade] = stock-counter theoretical (Summary!C) + Σ "S.MT" × blend fraction × 1000/60 …`). |
| R3 | `which contracts are behind the 16 FAQ shorts for June?` | explain-figure: exactly **SSKE-107713 (CHINALIGHT, −640 bags)** + **SSKE-107744 (SINJYCDINC, −320)**, total **−960** tying to the matrix cell; blend fractions shown; cite derivation names "Sale Ctr."/"S.MT"/blend fraction. |
| R4 | Upload `test-kit/01-XBS-Current-Stock-2026-06-18.csv` + `ingest this stock report, position date 2026-06-18` | Relays the **"demo-seeded snapshot … was CLEARED"** note; 808 rows / 35,568 bags / zero warnings. |
| R5 | `how much of my stock is blocked?` | 35,568 bags, of which 339 blocked (0.95%), carve-out phrasing. Footer has **NO demo badge** (real upload) and derivation `Σ XBS "Qty."(kg)/60 split on "Blocked"=Yes/No`. |
| R6 | **Reload the page**, reopen the same chat | Full history resumes; **no leaked narration bubbles** anywhere in the restored thread (the round-1 regression). |
| R7 | `what's my average purchase cost on the grinders I'm short?` | Decline: purchase-side prices are all zero on unallocated rows / no cost basis in the exports. No estimate. |
| R8 | `what data do you have on file?` then `delete the snapshot for 2026-06-18` | Lists 2026-06-18 (stock only). Delete: agent asks for explicit confirmation first; after `yes, delete it` → deleted, store empty. Leaves production clean. |

## After the run

`lua logs --ci` — verify: every tool call + input matches the scenario; `clearDemoSnapshot`/ingest wrote `demo: false`; no `agent_error` entries; no pre-tool narration text in the response stream.
