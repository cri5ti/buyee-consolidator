# Buyee Consolidator — specification

A Chrome extension that reads the packages waiting in a Buyee warehouse
("My Luggage"), lets you group them into consolidation boxes within value and
weight limits, and remembers the plan between visits.

Status: **v0.1 implemented**. Section 9 lists what is deliberately not built yet.

---

## 1. Goals

1. Read packages straight from the Buyee page — no manual export.
2. Plan which packages go in which box, by hand or automatically.
3. Keep the plan across sessions, and survive the list changing underneath it
   (consolidating removes packages from Buyee's list and new ones appear).
4. Surface urgency: packages whose free storage is running out or has ended.

Non-goals: backend or accounts, multi-user sync, carriers other than EMS,
automating Buyee's own consolidation flow (see §9).

## 2. Architecture

| Piece | Choice |
|---|---|
| Platform | Chrome extension, Manifest V3 |
| UI | React + TypeScript, Tailwind, built with Vite into `dist/` |
| Entry | Toolbar icon opens (or focuses) one full-page tab (`index.html`) |
| Page access | `chrome.scripting.executeScript` into an open `buyee.jp` tab |
| Persistence | `chrome.storage.local` (falls back to `localStorage` in `vite dev`) |
| Permissions | `storage`, `tabs`, `scripting`, host `https://buyee.jp/*` |

All data stays on the user's machine. The only network requests are to
`buyee.jp` (item pages, for pictures).

## 3. Data model

One `PackageItem` per `<li class="luggageInfo">`:

| Field | Source on the Buyee page |
|---|---|
| `id` | `li#id` / `data-baggageid` |
| `packageNumber` | `.package_number` |
| `originalValueYen` | Invoice → "Total Amount" (fallback: checkbox `data-invoice-total-price`) |
| `weightG` | Invoice → "Total Weight" |
| `dimensionsCm` | Invoice → "Dimensions" (`l × w × h`) |
| `freeStorageDaysLeft` | `.storage-remaining-days`, or the "Days until disposal" figure once free storage has ended |
| `storageExpired` | The "Days until disposal" label is visible |
| `lineItems` / `itemTitle` / `itemUrl` | Links in the item table (all items; the first is the title) |
| `gone` | Set by the merge (§5), not by parsing |

Derived: `valueGbp = originalValueYen × rate`, `volumeCm3 = l × w × h`.
Packages missing value, weight or dimensions are skipped and reported.

Stored state: `items`, `assignments` (`id → box 1–8 | 9 = excluded | null`),
`targetBoxes`, `lastScanAt`; plus separately the settings (§7), cached item
pictures and cached translations.

## 4. Scanning

**Scan Buyee** finds an open `buyee.jp` tab (preferring one whose URL contains
"baggage"), then in that page:

1. Repeatedly clicks a visible "load more" control (text matching
   load/show/view/see more) until the number of packages stops growing, up to
   40 clicks.
2. Returns the `outerHTML` of every `li.luggageInfo`, which the extension page
   parses with `DOMParser`.

The status line reports packages on the page and clicks made, and warns when no
load-more control was found. A dev-only HTML drop zone feeds the same parser.

## 5. Merging a rescan

Assignments are keyed by package id, so a rescan never disturbs them:

- Package in the scan and in the list → fields refreshed, assignment kept.
- Package new in the scan → added, **unassigned**.
- Package in the list but not in the scan → marked `gone`: greyed, crossed out,
  Box column shows "gone". Gone packages are ignored by auto-assign, the
  footer totals and the hotkeys. If one reappears it returns with its old box.
- A scan with zero packages is treated as an error, never as "everything gone".

**New** clears items, assignments and the saved plan (after confirmation).
Settings, pictures and translations are kept.

## 6. Planning UI

**Table** — sortable columns: package, item, yen, GBP, weight, volume, days
left, box. Row tint per box; selected row outlined.

- Keys: `↑/↓` move (in current sort order), `1`–`8` assign box, `x` exclude,
  `0` clear.
- Item title is a link that opens the Buyee item page in a new tab.
- Hovering a row shows a picture and caption for each line item (up to 4).
  Pictures are fetched from the item page's `og:image`, through the open Buyee
  tab, because Buyee sits behind a bot check that blocks a bare fetch.
- Days left: red badge `⚠ n` when free storage has ended (n = days until
  disposal); yellow `⚠ n` under 10 days; each with a matching left-edge bar.
  Expired sorts first ascending.
- **Translate titles** converts Japanese titles to English with Chrome's
  on-device Translator API (Chrome 138+), cached per title; an *English*
  checkbox toggles back to the original.

**Footer** (full): per box — items, value, score term, weight, volume,
volumetric weight, billable weight, estimated shipping, plus *Excluded* and
*Unassigned* cards. Value/weight over the cap is red; a box below the minimum
value is amber; a valid box is green. Each box has *Copy select script*
(jQuery to tick that box's packages in the Buyee console) and the footer has
*Clear all assignments*.

**Sticky summary bar** — the same cards reduced to box number, value and
weight, fixed to the bottom of the screen. Hidden while any part of the full
footer is visible.

## 7. Settings

Stored locally; apply immediately to totals, highlights and the next
auto-assign. Boxes already assigned are re-checked, not re-packed.

| Setting | Default |
|---|---|
| Max box value (£) | 135 |
| Min box value (£) | 40 |
| Max box weight (g) | 6000 |
| JPY → GBP rate | 0.004794 |

Shipping constants (EMS Zone 3 rate table, volumetric divisor 5000 cm³/kg)
live in `src/config.ts`.

## 8. Auto-assign

Pack the non-excluded, non-gone packages into at most *N* boxes (`N` chosen by
the user, 1–8, default = minimum boxes implied by the caps).

The problem is a two-constraint bin packing, so the solver is a heuristic:

1. **Seed** — greedy pack in random order: each package goes to the lightest
   box where it still fits; packages that fit nowhere stay unassigned.
2. **Improve** — roughly once a second ("generation"), run several trials that
   remove up to five random assignments and greedily re-pack them; keep the
   best.
3. **Fitness** (higher is better), in strict priority: no unassigned packages →
   within *N* boxes → no box over value/weight cap → no box under minimum value →
   then minimise estimated EMS shipping, with a small penalty for uneven box
   weights and for using fewer than *N* boxes.

It runs until stopped, writing into the same assignment state as manual edits;
the user can keep editing afterwards.

Estimated shipping = EMS Zone 3 rate for the larger of actual and volumetric
weight, converted to GBP.

## 9. Not built yet

- **Driving Buyee's consolidation flow**: ticking one package at a time on the
  Buyee page for a chosen box and submitting. The plan is already stored for
  this; today the footer's *Copy select script* is the manual route.
- Unit tests for the parser, merge and packing code (a sanitised fixture is
  needed — real exports contain personal data and must not be committed).
- Carriers or zones other than EMS Zone 3.
- Store listing assets and privacy policy.
