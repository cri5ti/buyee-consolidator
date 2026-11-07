# Implementation plan: Buyee consolidator

This document turns [1.md](./1.md) into an ordered build plan. Reference HTML export: [buyee.html](./buyee.html).

---

## 1. Goals (from spec)

- **Import**: User uploads a Buyee “My Luggage” style HTML export; parse every package into a normalized item model.
- **Display**: Table/grid with sortable columns; show JPY, computed GBP, volume, and consolidation box assignment.
- **Manual consolidation**: Row selection, keyboard navigation, numeric hotkeys to assign boxes; fixed footer with per-box totals.
- **Auto consolidation**: Under configurable caps (max declared value GBP, max weight g), suggest a packing that uses as few boxes as possible.

---

## 2. Tech stack and project bootstrap

| Piece | Choice |
|-------|--------|
| Bundler / dev | Vite |
| UI | React 18+ with TypeScript |
| Styling | Tailwind CSS |
| Parsing | DOMParser in the browser (no server required for MVP) |

**Bootstrap steps**

1. `npm create vite@latest` → React + TypeScript template.
2. Add Tailwind per current Vite docs (`tailwind.config`, `postcss.config`, `index.css` with `@tailwind` directives).
3. Set `strict` TypeScript; path alias `@/` optional.
4. Add a minimal `README` with “how to run” only if you want repo docs (spec did not require it).

---

## 3. Configuration module

Centralize tunables in e.g. `src/config.ts` (or env-backed constants):

| Key | Spec value | Notes |
|-----|------------|--------|
| `JPY_TO_GBP` | `0.004708` | Multiply JPY → GBP |
| `MAX_BOX_VALUE_GBP` | `135` | Auto-packing constraint |
| `MAX_BOX_WEIGHT_G` | `2000` | Auto-packing constraint |

Document that rates and limits are user-editable in one place.

---

## 4. Data model

**`PackageItem`** (one row per `<li class="luggageInfo">`):

| Field | Source in HTML | Parsing notes |
|-------|----------------|---------------|
| `id` | `<li id="...">` or `data-baggageid` | Prefer visible package id (e.g. `K0000000000`) |
| `packageNumber` | `.package_number` | Strip label text after `<b>Package number</b>` |
| `originalValueYen` | `.invoice_info` → `dt` “Total Amount” → following `dd` | Parse “2,250 YEN” → `2250` |
| `weightG` | `dt` “Total Weight” → `dd` | Parse “570g” |
| `dimensionsCm` | `dt` “Dimensions” → `dd` | Parse “45 × 28 × 22 cm” (handle `×`, `x`, spaces) → `{ l, w, h }` |
| `freeStorageDaysLeft` | `.storage-remaining-days` | Integer; handle missing as `null` / `—` in UI |

**Derived (computed, not stored in HTML):**

- `valueGbp = originalValueYen * JPY_TO_GBP`
- `volumeCm3 = l * w * h` (spec “volume”; cm³ is natural given cm dimensions)

Optional display helpers: formatted yen/GBP strings, rounded volume.

---

## 5. HTML import and validation

1. **Input**: `<input type="file" accept=".html,.htm,text/html">` or drag-and-drop; read as text.
2. **Parse**: `new DOMParser().parseFromString(html, 'text/html')`.
3. **Select**: `querySelectorAll('li.luggageInfo')` (or `#luggageInfo_collection > li`).
4. **Per-li extraction**: Scoped `querySelector` for invoice block (`.invoice_info` inside the same `<li>` if present; else walk from `li`—structure in sample is one `.invoice_info` per package in `delivery_info_container`).
5. **Robustness**: If invoice section is collapsed in some exports, prefer the same fields the site always renders; fall back to checkbox `data-invoice-total-price` on the sample input if “Total Amount” is missing (optional enhancement).
6. **Errors**: Surface count of parse failures with row index / package id; do not silently drop items without logging.

---

## 6. UI: main grid

- **Layout**: Full-width table (or CSS grid) with sticky header; mobile: horizontal scroll or card list (phase 2).
- **Columns** (suggested order): Package #, Item title (first line item link text or “—”), Yen, GBP, Weight (g), Volume (cm³), Days left, **Box** (assignment).
- **Sorting**: Click header toggles asc/desc; sort key per column type (string vs number). Keep sort state in React state; derive sorted list with `useMemo`.
- **Empty / loading**: Empty state before file; optional short “parsing…” during large files.

---

## 7. UI: selection and keyboard

- **Click row**: Sets `selectedId`; apply `bg-*` / ring for highlight.
- **Arrow Up / Down**: Move selection to previous/next row in **current sorted order** (document this behavior).
- **Focus**: Consider `tabIndex={0}` on table container or row roving tabindex so arrows work when the table is focused; show focus ring distinct from selection if needed.

---

## 8. UI: consolidation assignment

- **Hotkeys**: When focus is on the app (or document-level listener with guard): digits `1`–`9` assign selected item to box `n`; `0` clears assignment (`null`).
- **State**: `Record<itemId, boxNumber | null>` or `Map`; persist optional (localStorage) — not in spec, skip for v1.
- **Display**: Box column shows number or “—”.

---

## 9. UI: fixed footer (box summary)

Fixed to bottom (`fixed bottom-0` + padding on `main` to avoid overlap):

For each box id that has at least one item (or show boxes 1..max used):

- Item count  
- Sum of `valueGbp`  
- Sum of `weightG`  
- Sum of `volumeCm3`  

Also show **compliance** per box: green if ≤ max value and ≤ max weight; red/warning if over (manual mode allows over-cap; auto mode should not).

---

## 10. Auto consolidation algorithm

**Problem (informal):** Partition items into a minimum number of subsets (boxes) such that each subset satisfies:

- Σ value ≤ `MAX_BOX_VALUE_GBP`  
- Σ weight ≤ `MAX_BOX_WEIGHT_G`  

Volume is **not** in the spec as a hard cap; treat as informational unless you add `MAX_VOLUME` later.

**Reality check:** This is a **2-dimensional bin packing / variable-sized bin packing** style problem; exact minimization is hard. Pure “dynamic programming” over subsets works only for tiny *n* (2^50 is impossible). The spec’s “random swaps” idea is a **heuristic / local search**.

**Recommended approach (practical, good enough for 30–50 items):**

1. **Baseline — greedy First Fit Decreasing (FFD)**  
   - Sort items by a scalar key, e.g. `max(valueGbp / MAX_VALUE, weightG / MAX_WEIGHT)` (or by weight only).  
   - Place each item in the first existing box that fits; else open a new box.  
   - Fast, deterministic, often reasonable box count.

2. **Improvement — local search (matches spec spirit)**  
   - Start from FFD assignment.  
   - Repeat for *N* iterations (e.g. 5k–50k, tune by UX):  
     - Randomly pick an item and try moving it to another box or a new box if valid.  
     - Occasionally merge underfilled boxes by moving items.  
     - **Objective**: minimize `(number of non-empty boxes)`; tie-break with slack (e.g. prefer balanced weights).  
   - Keep the best feasible solution found.

3. **Optional stronger optimizer (if you want “closer to optimal”)**  
   - Small *n* (≤ 40): **CP-SAT** (e.g. Google OR-Tools) with binary variables `item i in box k` and constraints on sums; minimize box count. Heavier dependency and bundle size—likely overkill for v1.

**Deliverable:** Button **“Auto-assign”** that writes box numbers into the same assignment state as manual keys; user can still edit afterward. Show iteration count or “Done in X ms” optionally.

---

## 11. Implementation phases

| Phase | Scope | Exit criteria |
|-------|--------|----------------|
| **P0** | Vite + React + TS + Tailwind shell | Dev server runs, blank app |
| **P1** | Config + types + parser + file upload | `buyee.html` loads; grid shows correct counts and fields for sample file |
| **P2** | Sortable table + derived GBP/volume | All columns sort; numbers match spot checks |
| **P3** | Selection, arrows, digit keys, footer | Manual workflow complete per spec |
| **P4** | FFD + local-search auto-assign | Fewer or equal boxes vs naive greedy on test fixtures; never violates caps |
| **P5** | Polish | Accessible labels, error messages, keyboard help tooltip |

---

## 12. Testing strategy

- **Unit tests** (Vitest): Parser on snippets from `buyee.html` (copy minimal `<li>` fixtures) — yen/weight/dimensions/days.
- **Unit tests**: Auto-assign never exceeds caps; box count monotonicity vs trivial “one item per box”.
- **Manual**: Full `buyee.html` in browser; verify row count vs `li.luggageInfo` count.

---

## 13. Out of scope (unless you extend the spec)

- Backend / auth / multi-user persistence  
- Shipping cost optimization (only declared value + weight caps)  
- Strict volume limits per box  
- Internationalization  

---

## 14. File layout (suggested)

```
src/
  config.ts
  types/packageItem.ts
  parse/buyeeHtml.ts
  consolidate/
    greedy.ts
    localSearch.ts
  hooks/useBuyeeImport.ts
  components/
    PackageTable.tsx
    BoxFooter.tsx
    ImportDropzone.tsx
  App.tsx
```

This keeps parsing, packing logic, and UI separated for testing and iteration.
