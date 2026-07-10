# Questions for Ivo — Position Assistant

We've rebuilt your LongShort workbook logic inside the assistant, and it already reproduces your 18 June numbers exactly (net −4,850 bags, all the offer figures, the futures view). The questions below are the gaps only you can close. None of them are urgent individually, but each one unlocks something specific — they're grouped by what we get in return, with the most valuable first.

*Where a question mentions specific names or numbers, they come straight from your own 18 June exports, so everything should look familiar.*

---

## 1. The yield percentages you type into the stock counter ⭐ *most valuable single item*

When you use the stock-counter page, you type in the percentages that say how much of each parchment/in-process lot becomes which export grade. Those percentages are saved **only in your browser** — we can't see them, and they're the last missing piece of your stock forecast. With them, the assistant can reproduce your full "Expected" stock column automatically. Without them, we can only forecast about a third of the pipeline volume.

**Ask:** on the computer where you use the stock counter, do this once:

1. Open the stock-counter page in Chrome.
2. Press **F12** (a technical panel opens), click the **"Console"** tab.
3. Paste this line and press Enter:
   `copy(localStorage.getItem('processingPercentages'))`
4. The data is now copied — paste it into an email/WhatsApp to us. That's it.

*(If this is awkward, skip it — sections 2–4 below get us most of the way there manually.)*

---

## 2. Item names in the stock report we don't know how to grade

These raw item names appear in your XBS stock export, but we don't know which export grade each one should count toward. Together they're about **6,900 bags** we currently can't forecast:

| Item name in XBS | Which export grade should it feed? |
|---|---|
| ABOVE SCREEN 17 | |
| ABOVE SCREEN 14 | |
| BELOW SCREEN 17 | |
| BELOW SCREEN 16 | |
| Rejects L | |
| Rejects B | |
| REJECTS-REJECTS L/B | |
| Elevator Balance | |
| CHIPPINGS | |
| GRINDER B | |

## 3. Two strategy labels we can't place

Lots tagged **"GRINDER RECOVERABLE"** (~2,100 bags) and **"GRINDER LIGHT"** (~100 bags) don't match any strategy we know. Where in the PRE → IN → POST flow do they sit, and what do they become?

## 4. Splits you decide by feel — what's the rule of thumb?

When these come out of processing, how do you usually split them (rough percentages are fine)?

- **SPECIALTY** → which grades, in what proportion?
- **GRINDERS** → how much BOLD vs LIGHT?
- **MBUNIS** → MH vs ML?
- **REJECTS** → Rejects S vs Rejects P?
- **ABC** → how does it spread across 15/14 FAQ?

---

## 5. Blend choices the assistant will ask you about

The assistant learns which client blend each sale gets from your past assignments. For most sales it already knows. But for the combinations below, your history shows **more than one possible blend**, so it will ask rather than guess. If there's a rule you use, tell us and it can stop asking:

| Client / grade | Blends you've used before | How do you pick? |
|---|---|---|
| KONINKLIJKE — AB | #31, #32, #100 | |
| KONINKLIJKE — GRINDER | #104, #105 | |
| NESTRADE — AA | #91 (sometimes flagged) | |
| NANJINGECO — AA | #91, #100 | |
| SUCAFINA NA — AA | #18, #91 | |
| 32CUP — NAT. SPECIALTY | #91, #100 | |
| ALDINORD — GRINDER | (new — no history) | |
| NESTRADE — GRINDER | (new — no history) | |

*Also: if you have older versions of the BASE FILE (any past month), sharing them teaches the assistant more of your assignments and cuts down how often it asks.*

---

## 6. Small things in your workbook we want to confirm

1. **SPECIALTY WASHED counted inside POST NATURAL**, and **MBUNI HEAVY counted inside POST MH** (your sheet has a "+321 / Check −321" adjustment on the MH row) — are these permanent rules, or one-off fixes for that week?
2. Your Summary nets forward sales over a **fixed 10-month window** (Dec '25 – Sep '26 on the 18 June sheet). Should that window **roll forward** each month automatically?
3. One old sale is still open with an **October 2024** delivery month (SSWW-96188B, ~20 bags, Sucafina NA). The workbook's columns don't show it. Should ancient months like this still count in your shorts, or be ignored?

## 7. Prices — two quick confirmations

1. When SOL shows a sale's differential, is it **always in US cents per pound**, whatever the currency/unit of the flat price?
2. In SOL, the column "S.Hedge Value" shows 1 for some sales and 4 for others — what do those mean?
3. We'd like to **spot-check one price answer with you live**: the assistant says your grinder shorts average about **+28 c/lb over New York on BOLD and +8 on LIGHT** (as contracted). Does that feel right for 18 June?

## 8. Certificates — two different labelling systems

Your sales report tags certificates like `RA`, `RFA`, `4C.RFA`, `AAA.EUDR`. Your stock report tags them like `RAINFOREST ALLIANCE`, `FAIRTRADE`, `RFA,AAA`. We deliberately do **not** merge the two without your say-so.

**Ask:** how do the two sets correspond? (e.g. is stock "RAINFOREST ALLIANCE" the same thing as sales "RA"?)

## 9. Files that would unlock whole new answers

- The **three certificate workbooks** your Summary links to (AAA Cert Position, NET POSITION, CP-Purchases) → full certificate position answers.
- A **SOL futures export** (the pots: Kenyacof, KENY_AR_DYN etc.) → today those figures are typed in by hand each day; with the export they'd be automatic.

## 10. The morning report

The assistant can send a position summary every weekday before the market opens (currently set for 06:00 Nairobi). **Who should receive it, and is 06:00 the right time?**

---

*That's everything. Answers can come in any form — voice note walking through them is fine.*
