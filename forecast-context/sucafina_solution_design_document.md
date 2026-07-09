# Sucafina × Lua AI, Solution Design Document

### Internal build reference · all use cases · v1 (July 2026\)

*Single source of truth for the build team: engagement-level scope, governance, and systems up front; a full per-agent section for each of the seven use cases below.* 

**How to read this doc**

* Each agent section carries a **Phase** tag and a **Readiness** rating (Strong / Partial / Early).  
* **Dependencies are split** into *Access / provisioning* (things to chase down, they exist, we need access) and *Must build or elicit* (things to construct, including data that doesn't exist yet).  
* **Criteria & Classification** appears only on the agents where signal→output logic is substantive (CoE, Sample Management, Reconciliation).  
* The **systems matrix** in §D is the cross-agent view; each agent section repeats its own access detail so it can be handed off standalone.

# 

# PART 1, ENGAGEMENT SPINE

## A | Purpose & Scope Boundary

Lua AI is building working AI agent prototypes across seven Sucafina workflows spanning HR/Risk, Finance/CoE, Quality, Trading, and Ethiopia operations. Each agent takes the mechanical, high-frequency work off people's plates, answering policy questions, drafting invoice bookings, logging and dispatching samples, reconciling positions and stock, while every judgement call stays with a human.

The bottleneck across all of them is the same: the volume of manual system-keying and email coordination that grows with the business, against a system estate (SOL, XBS, SUN) that largely has no APIs. The build strategy is therefore to prove the model first on the workflows that are high-value *and* buildable without live SOL/XBS/SUN integration, and to isolate the SOL-dependent work (Position Analysis live, Ethiopia) as the higher-variance track.

**Scope boundary (applies to every agent):**

* Agents run on Sucafina's existing channels (Teams and SharePoint primarily, WhatsApp where enabled). Every action is logged and auditable.  
* Agents **surface signal and draft work; humans own every decision**, invoice posting, PSS approval, trading decisions, policy authority, and any external contact.  
* No agent writes to a live system of record (SOL / XBS / SUN) in the prototype phase. Where a "write" is described, it means producing a draft or a single human-posted entry, not direct system writes.

## B | Phasing & Agent Roster

| \# | Agent | Function | Phase | Readiness |
| :---- | :---- | :---- | :---- | :---- |
| 1 | HR/Risk Policy Bot | HR / Risk | **Phase 1** | Partial |
| 2 | CoE Invoice Entry & Payment Allocation | Finance / CoE | **Phase 1** | Partial |
| 3 | Sample Management Agent | Quality / Ops | **Phase 1** | Partial |
| 4 | Production & Trading Position Analysis | Trading / Ops | **Phase 2** | Early |
| 5 | Trading Assistant (External Info Digests) | Trading | **Phase 2** | Early |
| 6 | Ethiopia Value Chain | Ethiopia Ops | **Phase 2** | Early |
| 7 | Month-End Stock Reconciliation & Valuation | Finance | **Phase 2, keep/defer pending** | Early |

*Order follows Sucafina's own priority ranking (Ivo):*   
*Policy Bot (fastest win) → CoE (highest near-term regional value) → Sample Management (highest long-term potential) → Position Analysis (highest day-to-day value but hardest) → Trading Assistant (lowest conviction) → Ethiopia (most ambitious). Reconciliation & Valuation was surfaced later and awaits a keep/defer call.*

| Timeline | Milestone | Detail |
| :---- | :---- | :---- |
| **Week 1** | Scope & calibration | Provision access, gather sample data, confirm rules/corpus, calibrate confidence thresholds |
| **Week 1–2** | Phase 1 agents to testing (by Friday) | Policy Bot → CoE → Sample Management on live/near-live data; a human audits every output |
| **Week 3** | Go/No-Go review | Demo Phase 1; assess readiness to scale; roadmap for Phase 2 |

**Build principle:** confirm access and rules, calibrate confidence, then build each agent on live/near-live data with a human auditing every output. Each agent is trusted before the next is leaned on; Phase 2 begins only after the Go/No-Go decision.

## C | Governance & Human-Gate Model

Stated once; applies to every agent.

| Governance rule | Prototype-phase permission |
| :---- | :---- |
| Core automated steps | Autonomous within approved rules/rubric |
| Writing to a system of record | Drafts and single human-posted entries only; **no direct writes to SOL / XBS / SUN** |
| Externally-facing output (client/roaster emails, feedback chases) | Human-approved only |
| Final approval / decision (invoice posting, PSS, trades, policy authority) | Human only |
| Audit logging | Required for every agent action: data seen, reasoning, output, any override |

**Standard handoff schema**, what a reviewer sees when any agent output lands in front of them:

| Component | Content |
| :---- | :---- |
| Identity | Request / sample / invoice / contract / run reference, source, requester |
| Result | The draft, answer, or status the agent produced |
| Confidence & flags | Confidence level, exceptions, cert/tax/discrepancy flags, approval-needed state |
| Next action | Suggested action, missing info, what needs human sign-off |

## D | Systems Matrix (cross-agent)

Cell \= how each agent touches each system.   
read / write\* (draft or human-posted) / channel / source / track /, (not touched) / deferred (Phase 2 only).   
Kept in sync with the companion sucafina\_systems\_matrix.csv.

| System (access reality) | Policy | CoE | Sample | Position | Trading | Ethiopia | Recon |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **SOL**, no API; manual daily export | — | read | read | read (via Azure) | read | Read \+write\* | read |
| **XBS**, no API/cube; VPN; manual dl | — | — | read | read | — | — | read |
| **SUN / SAP**, finance system of record | — | write\* | — | — | — | — | write\* |
| **SharePoint**, invoice \+ policy store | read | Read \+write\* | — | — | — | — | — |
| **Teams**, primary channel | channel | — | channel \+source | channel | channel | channel \+source | channel |
| **WhatsApp**, secondary channel | — | — | possible | — | — | source | — |
| **Azure DB copy (Brian)**, read-only mirror | — | — | — | read (proto) | — | possible | — |
| **DHL / FedEx**, shipment tracking | — | — | track | — | — | track (PSS) | — |
| **Market data (ICE / broker)** | — | — | — | — | read | — | read (MtM) |
| **Phyto lab / cert rules** | — | — | read/ trigger | — | — | — | — |
| **Sample ledger (Excel/new)** | — | — | Read \+write\* | — | — | — | — |

*Reading down the SOL and XBS rows shows why those two integrations unblock the most: they're the widest-touched systems and have the worst access. The finance system of record appears as SUN and/or SAP depending on country/entity, confirm per entity.*

## E | Consolidated Open Decisions

| Open decision | Owner to confirm |
| :---- | :---- |
| Sample invoices, upload template, SharePoint approval examples | Finance team (this week) |
| Confidence thresholds per agent | Mayank+ process owners (Week 1\) |
| Feedback-capture mechanism (new data store, Sample Mgmt) | Quality \+ vendor |
| SuccessFactors/SAP leave integration for Policy Bot | HR (currently deferred) |
| VPN \+ Azure DB read access provisioning (Position, Phase 2 gate) | Sucafina sponsor (Ivo) |
| Live SOL interaction method (Ethiopia gate) | Mayank \+ Sucafina IT cover |
| Keep or defer Reconciliation & Valuation | Sucafina sponsor (Ivo) \+ finance leadership |
| Trading Assistant priority (post desk-walkthrough) | Trading desk \+ vendor |

# 

# PART 2, AGENT SECTIONS

## 1 | HR/Risk Policy Bot

**Phase 1 · Readiness: Partial**   
**· Function: HR / Risk**   
**· Sponsor: Ivo (Sucafina); originated from the Global CEO**   
**Purpose:** A Teams chatbot that answers "what's our policy on X / can I do Y" by quoting the relevant HR or Risk policy, with a disclaimer to confirm with a human if unsure.

**Trigger**, Inbound message: a staff member asks a policy question in Teams.

**Information flow**

1. User asks a policy question in Teams.  
2. Agent retrieves the relevant passage from the policy corpus (SharePoint).  
3. Agent answers, quoting the policy, plus a standing disclaimer ("I'm a bot, confirm with \[owner\] if unsure").  
4. If out of corpus, agent defers to the human owner rather than guessing.

**Systems & access**   
| System 	| Role 	| Access method |   
| SharePoint / policy docs 	| Source (corpus: POL / PR / PROC files) 	| File-based; already shared |   
| Teams 	| Channel 	| Integration in progress |   
| SuccessFactors (SAP) 	| Source (personal HR data, e.g. leave balance) 	| TBD, secondary, out of first build |

**Human touchpoints**, Bot disclaimer routes users to the HR/Risk owner when unsure; those leads own the content and are the escalation point.

**Inputs → Outputs**, Policy docs \+ \~20–25 MCQ risk-awareness assessment (the accuracy test set) → Teams reply quoting the applicable policy \+ disclaimer.

**Dependencies, Access / provisioning**

- Teams integration live (main technical dependency; target Friday).  
- SharePoint read access to the corpus.

**Dependencies, Must build or elicit**

- Confirmation the corpus is complete/organised (Ivo noted the source may not be fully assembled).  
- The RAG retrieval \+ disclaimer behaviour and the MCQ eval harness.

**Known constraints & open questions**, Corpus completeness uncertain. Whether to include the SuccessFactors leave-balance integration at all. Scope note: the CV Database sub-case was dropped, this is HR/Risk *policy* only.

**Acceptance signal**, Correctly answers the \~20–25 MCQ assessment set with the right policy quoted, and defers cleanly when a question is out of corpus.

**Workflow diagram**, see Excalidraw *HR / Risk Policy Bot, Workflow*.

## 2 | CoE Invoice Entry & Payment Allocation

**Phase 1 · Readiness: Partial · Function: Finance / CoE (Uganda-first) · Sponsor: Ivo** **Purpose:** Draft the accounting entries for an incoming invoice (GL lines, tax treatment, both reference numbers) as a colour-coded confidence Excel, routed through the existing SharePoint approval channel, for a human to review and post.

**Trigger**, Inbound document \+ approval-state change: Uganda invoices land in the SharePoint channel pre-filled via the approval workflow; Kenya/others arrive by email to a generic per-country inbox.

**Information flow**

1. Invoice arrives (SharePoint in Uganda; email inbox elsewhere).  
2. Approval gate (Uganda pattern, the target state): a line manager/COO approves before booking.  
3. Agent extracts gross, tax, total, the vendor invoice number, and the government tax-authority reference number (both required; each unique per country).  
4. Agent classifies the invoice, goods / service / professional fee (professional fees are a defined, listable category).  
5. Agent applies tax logic: 2% VAT withholding (no threshold); 5% professional-fee withholding (only above shillings 24,000); 6-month recency rule for expense vs. capitalize.  
6. Agent drafts the three-line GL booking (service / tax / total) to the correct GL codes, in the fixed Excel template.  
7. Agent colour-codes each line by confidence, yellow flags ambiguity (mixed goods+service, edge-case vendors); clean lines pass high-confidence.  
8. Draft Excel delivered into the SharePoint channel alongside the source invoice.  
9. Human reviews, corrects yellow lines, and posts, the agent does not post directly.

**Systems & access**   
| System 	| Role 	| Access method |   
| :--- 	| :--- 	| :--- |   
| SharePoint 	| Source (Uganda invoices \+ 	| Read/write; client's preferred channel |   
	| approvals) / destination (draft)	| for audit trail |   
| Email (per-country inbox) 	| Source (Kenya \+ non-Uganda) 	| Read access to shared inbox |   
| Finance system (SAP / SUN) 	| Destination (system of record) 	| No direct write in prototype, human posts |   
| Fixed Excel template 	| Output format 	| File-based; standardized, cannot be changed |   
| Tax rule reference 	| Source (classification logic) 	| To document/confirm per country |

**Human touchpoints**, Approver (line manager/COO) approves before booking; accountant reviews the colour-coded draft, resolves yellow lines, and posts.

**Inputs → Outputs**, Invoice \+ approval status \+ reference numbers → draft three-line GL booking in the fixed template, colour-coded by confidence.

**Criteria & Classification**   
| Signal 	| Agent proceeds (confident) 	| Flag to human |   
| :--- 	| :--- 	| :--- |   
| Classification 	| Clear goods / service / professional-fee match | Mixed or ambiguous invoice → yellow |   
| Tax treatment 	| Thresholds/rules unambiguous 	| Edge case near a threshold or unusual vendor → yellow |   
| Reference numbers 	| Both captured cleanly 	| Missing/unreadable tax-authority number → hold |

| Output state | Definition | Agent action |
| :---- | :---- | :---- |
| Drafted (green) | High-confidence booking | Deliver for posting |
| Flagged (yellow) | Low-confidence line(s) | Surface with the reason |
| Held | Missing required data | Request/await before drafting |

**Dependencies, Access / provisioning**

* SharePoint read/write access; access to the per-country email inbox.  
* Sample invoices, the fixed upload-template Excel, and SharePoint approval examples (requested this week).

**Dependencies, Must build or elicit**

* A working, country-specific tax-classification rule set (Kenya captured; other countries to confirm before extending beyond Uganda).  
* A supplier→classification memory layer, updatable by telling the agent.  
* Enforcement/visibility that invoices bypassing SharePoint don't silently skip the agent.

**Known constraints & open questions**, Tax edge cases are judgment-heavy (the team cautioned against over-engineering; the yellow-flag approach was their own proposal). Whether this replaces Kenya's monthly Excel-to-system upload cadence or just the drafting. Effort baseline soft (\~2 people, \~40 hrs/week on invoices in Kenya, self-reported). Uganda-first; extension needs per-country rule confirmation.

**Acceptance signal**, On a batch of real invoices, the drafted Excel matches the accountant's own booking on clean lines, with only genuine edge cases flagged yellow.

## 3 | Sample Management Agent

**Phase 1 · Readiness: Partial · Function: Quality / Ops · Owner: Quality lab (Harriet, intake/DHL); Ivo approves PSS** **Purpose:** Capture sample requests into a structured ledger, run the send process (spec/cert/label/dispatch), track shipment to delivery, and close the currently-missing feedback loop.

**Trigger**, Inbound message (ad hoc) \+ schedule (PSS): type samples and stock lots requested ad hoc via Teams; PSS is calendar-driven \~6 weeks before shipment month-end.

**Information flow**

1. Request arrives (Teams).  
2. Agent creates a structured ledger entry: client, sample type, spec, volume, destination, notes.  
3. Agent asks clarifying questions inline if fields are missing.  
4. Destination rules: China/Japan → flag phyto-sanitary certificate required before dispatch.  
5. Agent prepares the print label and logs blend detail (in stack/post-processing terms).  
6. On dispatch, agent creates the DHL/FedEx pickup and records the tracking code.  
7. Daily: agent checks tracking, flags stalls (port/customs), notifies the right person.  
8. Post-delivery: agent reminds client support/Harriet to chase feedback (accepted/rejected).  
9. Feedback captured in the ledger; agent summarizes a client's history on request.

*Sample types: type sample (predefined recipe blend, may not physically exist yet) · stock lot (physical coffee on hand) · PSS (tied to a confirmed order; extra approval, Ivo checks blend vs. target, deviation, profitability).*

**Systems & access**   
| System 	| Role 	| Access method 	|   
| :--- 	| :--- 	| :--- 	|   
| Teams 	| Channel \+ source (request chats) 	| Integration in progress; chat export shared 	|   
| Sample tracking Excel 	| System of record (informal) 	| File-based; nothing updated after send 	|   
| DHL / FedEx 	| Shipment tracking 	| Public tracking / API 	|   
| Phyto lab / certificates 	| Compliance 	| Manual; \~1-day turnaround 	|   
| SOL 	| Order context (PSS) 	| No API; connection deferred to phase 2 	|   
| XBS 	| Stock-lot availability \+ blends 	| No API; VPN; manual download 	|

**Human touchpoints**, Quality lab prepares/sends (no extra approval except PSS → Ivo); Harriet does intake \+ DHL; client support chases feedback (agent drafts the reminder, human sends).

**Inputs → Outputs**, Teams request messages, spec, blend %, destination → ledger entry, printable label, DHL pickup, tracking flags, feedback reminders, history summaries.

**Criteria & Classification**   
| Signal 	| Agent proceeds 	| Hold / flag 	|   
| :--- 	| :--- 	| :--- 	|   
| Request completeness 	| All fields present 	| Missing volume/destination → ask 	|   
| Compliance 	| No special handling 	| China/Japan → flag cert requirement before dispatch 	|   
| Sample type 	| Type / stock lot 	| PSS → route to Ivo for blend approval first 	|   
| Shipment status 	| Moving normally 	| Stalled in port/customs → flag \+ notify 	|

| Output state | Definition | Agent action |
| :---- | :---- | :---- |
| Logged | Request captured | Enter ledger, proceed |
| Dispatched / tracking | Sent, in transit | Daily tracking loop |
| Feedback captured | Accept/reject recorded | Update ledger \+ history |
| Pending approval | PSS awaiting Ivo | Hold dispatch |

**Dependencies, Access / provisioning**

- Teams integration; DHL/FedEx tracking access.  
- Destination → certificate rules list (to be provided).

**Dependencies, Must build or elicit**

- **The feedback record itself, it does not exist today.** No structured accept/reject data exists in any system; this foundational data must be created, not connected.  
- The structured ledger schema (the current Excel is informal and stops at dispatch).  
- PSS order-context link (needs SOL; deferred).

**Known constraints & open questions**, Feedback collection is genuinely hard (clients often don't respond; best signal is simply accept/reject). Both a generic and a detailed blend spec need capturing. Volume "hundreds/year," \~20/week (self-reported). Clean Teams-chat export unresolved.

**Acceptance signal**, A Teams request is logged, dispatched, tracked, and its accept/reject feedback captured end to end, with the feedback record persisting where none existed before.

**Workflow diagram**, see Excalidraw *Sample Management Agent, Workflow*.

## 4 | Production & Trading Position Analysis

**Phase 2 · Readiness: Early**   
**· Function: Trading / Ops**   
**· Owner/primary user: Ivo (trader); secondary: Ivo's boss (self-serve)**   
**Purpose:** Answer position questions, what's on hand, what's owed, net position by date, and what-if scenarios, and deliver a morning position report.

**Trigger**, Schedule (morning report) \+ on-demand query (Teams).

**Information flow**

1. Agent connects to the position data (prototype: Brian's Azure DB copy of SOL/XBS).  
2. Ingests stock (longs, coffee on hand, in stacks) and contracts/logistics (shorts, what's owed, by client, by date).  
3. Applies the stock-counter processing logic (raw → post-processed, \~100 categories, replicating Ivo's tool).  
4. Maintains net position by date (net \= longs − shorts).  
5. Morning: generates a position report.  
6. On demand: answers what-if questions ("can I sell this much by this date without running out").

**Systems & access**   
| System | Role | Access method |   
| :--- | :--- | :--- |   
| SOL | System of record (contracts) | No API; manual daily export; deferred to phase 2 |   
| XBS | System of record (stock) | No API/cube; VPN; manual download |   
| Azure DB copy (Brian) | Prototype data source (SOL/XBS mirror) | Read-only; manual refresh, single point of failure |   
| Stock counter (Ivo's tool) | Processing logic to replicate | Local; drag-and-drop Excel |   
| Teams | Channel (queries \+ delivery) | Integration in progress |

**Human touchpoints**, Ivo checks position constantly (target: remove the \~10 min/day manual reconciliation, self-reported); his boss wants to self-serve rather than call.

**Inputs → Outputs**, XBS stock report \+ two logistics/position reports → morning position report \+ on-demand what-if answers. Dashboard vs. conversational output undecided (Ivo leans conversational).

**Dependencies, Access / provisioning**

- VPN \+ Azure DB read access (not yet provisioned; overdue).  
- Brian maintaining the Azure copy (manual refresh, SPOF).

**Dependencies, Must build or elicit**

- The stock-counter processing logic and the what-if rules, currently only in Ivo's head; must be elicited and encoded.  
- A \~100-row sample of position data for structure (to be shared).

**Known constraints & open questions**, Prototype runs on the Azure copy; live SOL/XBS integration is phase 2, blocked by no API. Azure copy only as current as Brian's last manual refresh. Dashboard vs. conversational output not settled.

**Acceptance signal**, The agent's net-position-by-date matches Ivo's manual morning reconciliation for a live day, and answers a representative what-if correctly.

**Workflow diagram**, see Excalidraw *Production & Trading Position Analysis, Workflow*.

## 5 | Trading Assistant (External Info Digests)

**Phase 2 · Readiness: Early**   
**· Function: Trading**   
**· Owner: Trading desks (lowest internal conviction)**   
**Purpose:** A scheduled digest surfacing the market, weather, regulatory, and competitive signals a trader would otherwise hunt for manually, organized around four pillars.

**Trigger**, Schedule: daily (or desk-defined) digest before the trading day opens.

**Information flow**

1. Agent pulls from four pillars: fundamentals (supply/demand, crop), technicals (price action), positioning (open interest), macro (FX, rates, regulatory).  
2. Separately, consolidates competitor offer lists (explicitly requested by the Ethiopia team).  
3. Assembles a per-desk digest (signals relevant to that desk's exposure).  
4. Delivered on schedule; trader can ask follow-ups on demand.

*Fundamentals and positioning flagged as most tractable to prototype first; technicals/macro depend on live market-data feeds and are lower priority.*

**Systems & access**   
| System | Role | Access method |   
| :--- | :--- | :--- | | ICE / futures | Market data (fundamentals/technicals) | Email/PDF or paid feed (cost) | | Weather/agronomic APIs | Fundamentals | API/public | | Regulatory feeds (EUDR, GCP) | Macro/compliance | Public/scraped | | Competitor offer lists | Competitive signal | Manually collected today; source TBD | | Contract book (SAP/SOL) | Exposure cross-reference | No API; manual export | | Teams / Slack / email | Delivery channel | Integration in progress |

**Human touchpoints**, Traders consume and decide; the agent surfaces signal, never recommends trades. Desk heads may weight pillars per region.

**Inputs → Outputs**, Futures, weather, regulatory feeds, competitor lists, internal contract book → per-desk digest \+ on-demand Q\&A.

**Dependencies, Access / provisioning**

- Market-data access (paid feeds have a cost, scope/budget undecided).  
- Contract-book export access.

**Dependencies, Must build or elicit**

- A list of typical trader questions/desired signals (requested from Ivo, outstanding).  
- Competitor offer-list source and format (undefined).  
- Full trading-desk walkthrough (scheduled, not yet done) to confirm demand and reset priority.

**Known constraints & open questions**, Lowest-conviction use case; confirm real demand before significant build. Overlaps Position Analysis (both use the contract book), consider a shared data layer. Risk of a technically-working digest that goes unused because it misses the one or two signals that drive behaviour ("you need so much to make that useful", Ivo).

**Acceptance signal**, A desk receives a digest a trader confirms would replace their manual scan for that day. *(Soft, reassess after the desk walkthrough.)*

---

## 6 | Ethiopia Value Chain (Reminders, SOPs & Ops Workflows)

**Phase 2 · Readiness: Early**   
**· Function: Ethiopia Ops**   
**· Team: Timnet (purchase/sales), Mikyas (quality), Kirubel (ops), Yosef (logistics); sponsors Joe & Omar**   
**Purpose:** Reduce the heavy manual SOL data entry in Ethiopia's purchase-to-payment cycle, contract creation and repeated logistics status updates, via a conversational (WhatsApp/Teams) interface, ideally without opening SOL directly.

**Trigger**, Inbound message (Teams purchase-decision chat) \+ milestone events (each logistics status change).

**Information flow**

1. Purchase decision made in a Teams chat (Timnet, Joe, Omar), quantity, price, shipper.  
2. Timnet emails a purchase confirmation to the shipper.  
3. Contract created from scratch in SOL (Ethiopia doesn't template from old contracts), seller, quality, quantity, price, basis, shipment, destination, payment/sample terms; ref auto-generates. \~10–15 min each (self-reported).  
4. SOL generates the contract PDF → shipper signs → binding.  
5. Logistics: shipping instruction sent; shipper books vessel; booking confirmation (vessel/ATD/ETA) recorded in SOL.  
6. PSS: collected from shipper's warehouse, sent via DHL, approval recorded in SOL, but only \~10–15% of the time (clients rarely ask).  
7. Containers stuffed → status "on ground."  
8. Status updates continue: loaded → afloat → arrival, plus a newly-added "on ground/stuffed" step, effectively doubling updates from \~2 to \~4 per contract. At peak, 10–15 parallel shipments, 13–15 fields each, \~10–15 min per update session (self-reported).  
9. Shipping docs (commercial invoice, packing list, certs, signed contract) uploaded to SOL as received.  
10. On departure, original BL obtained → shipper's bank → bank-to-bank payment. Ethiopia's responsibility continues to destination arrival.  
11. Claims: buyer notifies by email → if accepted, credit/debit note in SOL. Quality claims may need a return sample; weight claims largely automatic. Negotiation up to a month (self-reported); resolution shipper-paid or passed to a separate central insurance team.

**Systems & access** | System | Role | Access method | | :--- | :--- | :--- | | SOL | System of record (contracts, status, docs, claims) | No API, the whole use case tests whether the agent can operate it like a human | | Teams | Channel \+ source (purchase decisions) | Integration in progress | | Shipping-line tracking sites | Post-Djibouti tracking | Public portals | | Email | Source (confirmations, claims, shipper docs) | Manual | | DHL | PSS delivery | Tracking/API | | Central insurance team | External handoff | Manual, out of scope for agent action |

**Human touchpoints**, Timnet (purchase, contract creation, negotiation); Joe/Omar (commercial sign-off); Kirubel/Yosef (loading supervision, status, claims screening); central insurance team (independent).

**Inputs → Outputs**, Teams purchase chat, confirmation emails, booking confirmations, vessel data, shipping docs, claims correspondence → SOL contract record, SOL status updates, uploaded docs, claims entries.

**Dependencies, Access / provisioning**

- Redacted sample email→contract pairs (Ivo to collect, due Jul 8).  
- Omar's return (\~Jul 14\) for final sign-off (session proceeded with Joe as fallback).

**Dependencies, Must build or elicit**

- **A proven method for the agent to interact with SOL** (contract creation \+ status updates), nothing here ships without this; it's the single gating unknown.  
- The extraction-to-contract field mapping and the status-update sequencing logic.

**Known constraints & open questions**, Explicitly the hardest use case; scoped "assuming we can connect to SOL", a real chance it doesn't ship a prototype if that fails. Adding a granular status step already worsened the manual burden (caution against more tracking granularity without automating the update). Claims negotiation is human/relationship-driven (agent scope \= capture \+ tracking, not negotiation). Intermediary-driven model makes volume/timing data softer.

**Acceptance signal**, The agent creates a valid SOL contract from a sample email and pushes one status update, proving SOL operation at all.

## 7 | Month-End Stock Reconciliation & Valuation

**Phase 2, keep/defer pending · Readiness: Early**   
**· Function: Finance**   
**· Owner: a finance manager (month-end close)**

**Status note:** surfaced by the client during discovery (not one of the original six) and **pending a keep/defer decision.** Scoped below *if kept*, with the lower-risk reconciliation piece separated from the higher-risk valuation piece so the decision can be made piece by piece.

**Purpose:** Reconcile stock movement across systems (purchases, processing, dispatches, sales) against a physical warehouse count, then value the resulting inventory two ways, for the balance sheet and for group mark-to-market reporting.

**Trigger**, Schedule: monthly close, report due by the 7th of the following month. Currently spread across \~3–4 weeks (self-reported); the reconciliation portion could compress to \~a day in one uninterrupted session.

**Information flow** *A, Reconciliation (lower risk; recommended starting scope if kept):*

1. Buy-side check: SOL purchases vs. month's expectations (tracked incrementally).  
2. Processing: pull a condensed processing summary from XBS into Excel.  
3. Sell-side check: every SOL sales invoice should have a matching XBS dispatch, reconcile; flag mismatches (usually cutoff/timing, handled with a manual carry-over today).  
4. Movement: opening \+ purchases ± processing ± dispatches \= calculated closing.  
5. Separate "dispatched but not shipped" (still inventory until past the port).  
6. Tie to physical count (human-performed); mismatch → investigate (the preparer's single biggest pain point).  
7. Push one net adjustment figure into the finance system (SUN/SAP), a single human entry.

*B, Valuation (higher risk; judgment-heavy; propose deferring even if reconciliation is kept):* 8\. Standard-price (balance sheet): lower of last purchase / replacement / 4-month weighted average. 9\. Mark-to-market / valorization (group reporting): value on the differential (basis) between physical and futures, enabling incremental P\&L rather than waiting for physical sale. \~3 hrs/cycle (self-reported). 10\. Both compared against the finance system's current figure, the difference is what matters.

**Systems & access** | System | Role | Access method | | :--- | :--- | :--- | | XBS | Source (processing, dispatch) | Login/OTP-gated download; easiest to extract from | | SOL / SUN | System of record ("holds the truth") | No API; manual | | Excel | Working layer (movement, valuation) | File-based; fixed pattern | | Physical warehouse count | Ground truth | Manual, the anchor point | | Purchases reference sheet | Standard-price lookup | Excel |

**Human touchpoints**, Finance manager owns and confirms the draft movement \+ flagged discrepancies before pushing the final figure. Leadership consumes it for buy/sell, insurance/financing declarations, and statutory reporting, errors have business consequences, not just accounting ones.

**Inputs → Outputs**, XBS extracts, SOL/SUN sales invoices, physical count, purchases sheet, market/futures pricing → validated monthly movement, one net adjustment to the finance system, two valuations.

**Criteria & Classification** | Signal | Agent proceeds | Flag to human | | :--- | :--- | :--- | | Sales ↔ dispatch match | Clean match | Mismatch → flag (likely cutoff/timing) | | Calculated vs. physical count | Within tolerance | Out of tolerance → flag for investigation | | Cutoff timing | Clear-cut period | Ambiguous carry-over → flag rather than auto-adjust |

| Output state | Definition | Agent action |
| :---- | :---- | :---- |
| Reconciled | Movement ties to count | Prepare net adjustment |
| Discrepancy | Count/system mismatch | Surface with the suspected cause |
| Valued | Standard \+ MtM computed | Present delta vs. system (if valuation in scope) |

**Dependencies, Access / provisioning**

- One full month's reconciliation/valuation Excel \+ matching XBS extracts (to validate logic).  
- Clarity on what can be pushed into SUN/SAP programmatically vs. manually (preparer unsure).

**Dependencies, Must build or elicit**

- **The keep/defer decision**, nothing is built until this resolves.  
- The reconciliation logic (movement build, cutoff rules) and, if in scope, the valuation logic (lower-of-three; differential/valorization).  
- A rule for when to auto-carry-over vs. flag a cutoff discrepancy.

**Known constraints & open questions**, Highest-stakes, most judgment-heavy case; output feeds statutory financials and real decisions. Recommend, if kept, scoping to extraction \+ reconciliation \+ discrepancy-flagging first, valuation as a distinct later phase. The "local vs. Swiss" valuation distinction was explicitly called irrelevant, don't build for it. Effort figures self-reported, not cross-checked.

**Acceptance signal**, The agent's calculated closing movement ties to the physical count within tolerance, flagging the same discrepancies the preparer would investigate. *(Reconciliation half; valuation acceptance defined separately if that piece is kept.)*  
