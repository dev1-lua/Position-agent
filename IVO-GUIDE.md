# Position Assistant — how to use it (guide for Ivo)

The assistant does your LongShort workbook maths for you: **longs (stock) − shorts (forward sales) = net position**, by grade and delivery month, plus offers, price levels, bookings, certs, and the futures view. You upload the same three exports you already download every morning; it does the rest. It never gives trade advice and it never guesses a number — if the data doesn't contain something, it says so.

## Getting in

1. Open **https://position-agent.vercel.app**
2. Enter the access password (ask Dev for it).
3. You land in the chat. **New chat** starts a fresh conversation; your old chats stay in the list on the left and resume where you left off.

## The morning routine (2 minutes)

Upload your three daily exports — same files, no editing needed:

| # | File | Where you get it today |
|---|---|---|
| 1 | **XBS Current Stock** (.csv or .xlsx) | XBS, manual download |
| 2 | **SOL ReportLogistic** (.xls) | SOL, "6-Sales Unallocated" export |
| 3 | **SOL DailyNetPosition** (.xls) | SOL |

For each: click the **paper-clip** in the chat, pick the file, and type something like:

> *ingest this, position date 2026-07-15*

(If the export is for today you can skip the date.) The assistant recognizes each file by its contents and confirms what it read — row counts, totals, and any warnings if the export looks different from usual. **Read those warnings** — they mean the source system changed something.

Then say:

> *compute my position*

It may come back with a short list of sales it won't allocate on its own — **blend confirmations**. It only asks when your own history is ambiguous (e.g. a KONINKLIJKE AB sale that has used blends #31, #32 and #100 before). Answer with the blend number ("SSKE-107812 is blend 32") and it remembers your answer for next time. It will never pick one silently.

That's it. Now ask anything.

## What you can ask (in your own words)

**Position**
- *what's my net position?*
- *how short am I on AB FAQ?*
- *by-month shorts breakdown* / *shorts for September, by grade*
- *can I sell 500 bags of 17-up FAQ for August without going short?*

**Prices** (price level = differential vs NY KC, in USc/lb)
- *at what price level am I short on grinders?*
- *how much of my book re-rates if NY moves?* (the price-to-be-fixed part)
- *average dif by client / by delivery month / by fixing month*

**Clients & shipments**
- *who am I most short to?*
- *who buys my grinders?*
- *what's booked to ship in June? anything booked but no vessel yet?*

**Stock & certs**
- *how much stock is blocked? stock by warehouse? how old is it?*
- *how much of my book is EUDR?* (it will give floors — only tagged volume counts)

**Checking a number**
- *where does that −5,844 come from?* / *which contracts are behind that?* — it lists the exact sale contracts, with volumes and blend fractions, that add up to the figure.

**Housekeeping**
- *what data do you have?* (lists the days on file)
- *delete the snapshot for <date>* (it asks you to confirm — this is permanent)

## How to read an answer

Every answer with numbers ends with a small **source line**, for example:

> `price-analytics · snapshot 2026-07-15 · SOL ReportLogistic · ingested 07:12 · difs = SMT-weighted "S.Dif"/"S.Fob dif"`

That tells you: which calculation, which day's data, which of your files it came from, when you uploaded it, and the exact columns/formula behind the figure. **If you ever see an amber "DEMO DATA" badge, the answer is from the built-in practice day (18 June), not your uploads.** Real uploads never carry that badge.

## What it will NOT do (by design)

- **No trade advice** — it gives you the numbers; the call is yours.
- **No P&L / mark-to-market** — your exports carry no market prices or cost basis, so it refuses rather than estimates.
- **No invoices, containers, B/L numbers** — not in the exports.
- **Untagged ≠ non-certified** — volume without a cert tag is reported as *unknown*, never as "not certified".
- If you upload a file it doesn't recognize, it will **ask you what it is** instead of ingesting it.

## Good to know

- The **morning report** can land in your inbox before the market opens (currently 06:00) with the latest net, offers and warnings — tell Dev where to send it.
- The **practice day**: say *load the demo day* to get a full 18 June dataset for trying things out. It's always clearly labelled, and uploading a real file for that date replaces it completely.
- Tables have small **copy / download** buttons (top-right of each table) if you want the numbers in Excel.
- If an answer says data is **stale or missing**, it's telling the truth — upload today's exports and ask again.

## If something looks wrong

Don't work around it — screenshot the answer and send it to Dev. Every number is traceable to your files, so a wrong-looking figure is either a real position surprise or something we want to fix the same day.
