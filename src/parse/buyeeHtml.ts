import type { DimensionsCm, PackageItem } from "../types/packageItem";

export type ParseError = { index: number; packageId: string; message: string };

export type ParseResult = {
  items: PackageItem[];
  errors: ParseError[];
};

function stripCommas(s: string): string {
  return s.replace(/,/g, "");
}

/** Parses "2,250 YEN" or "2250 YEN" → 2250 */
export function parseYenYen(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = stripCommas(text).match(/(\d+(?:\.\d+)?)\s*YEN/i);
  if (!m) return null;
  return Math.round(Number(m[1]));
}

/** Parses "570g" → 570 */
export function parseWeightG(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*g/i);
  if (!m) return null;
  return Math.round(Number(m[1]));
}

/** Parses "45 × 28 × 22 cm" or "20x32x9" → dimensions */
export function parseDimensionsCm(
  text: string | null | undefined,
): DimensionsCm | null {
  if (!text) return null;
  const normalized = text.replace(/×/g, "x").replace(/\s+/g, " ");
  const nums = normalized.match(/(\d+(?:\.\d+)?)/g);
  if (!nums || nums.length < 3) return null;
  return {
    l: Number(nums[0]),
    w: Number(nums[1]),
    h: Number(nums[2]),
  };
}

function textAfterBoldPackageNumber(el: Element | null): string {
  if (!el) return "";
  const raw = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return raw.replace(/^Package number\s*/i, "").trim();
}

function findDdForDt(container: Element, label: string): string | null {
  const dts = container.querySelectorAll("dt");
  for (const dt of dts) {
    if (dt.textContent?.trim().includes(label)) {
      let sib: Element | null = dt.nextElementSibling;
      while (sib && sib.tagName !== "DD") sib = sib.nextElementSibling;
      if (sib?.tagName === "DD") return sib.textContent?.trim() ?? null;
    }
  }
  return null;
}

function itemLinks(li: Element): { title: string; url: string }[] {
  const all = Array.from(
    li.querySelectorAll<HTMLAnchorElement>(".luggageInfo_order td a"),
  );
  const preferred = all.filter((a) => /\/item\//.test(a.getAttribute("href") ?? ""));
  const out: { title: string; url: string }[] = [];
  for (const a of preferred.length ? preferred : all) {
    const href = a.getAttribute("href")?.trim();
    if (!href || href.startsWith("javascript")) continue;
    try {
      out.push({
        title: a.textContent?.replace(/\s+/g, " ").trim() || "—",
        url: new URL(href, "https://buyee.jp/").toString(),
      });
    } catch {
      /* skip bad href */
    }
  }
  return out;
}

function firstItemTitle(li: Element): string {
  const first = itemLinks(li)[0];
  if (first) return first.title;
  const cell = li.querySelector(".luggageInfo_order tr:nth-child(2) td:nth-child(3)");
  return cell?.textContent?.replace(/\s+/g, " ").trim() || "—";
}

function firstInt(text: string | null | undefined): number | null {
  const m = text?.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Buyee renders both the "free storage" and "days until disposal" labels and
 * toggles them with inline display:none. Once the free period has passed the
 * "Days until disposal" label is the visible one.
 */
function parseStorage(li: Element): { days: number | null; expired: boolean } {
  for (const label of li.querySelectorAll(".storage-info-label")) {
    if (!/until disposal/i.test(label.textContent ?? "")) continue;
    const hidden = /display\s*:\s*none/i.test(label.getAttribute("style") ?? "");
    if (hidden) break;
    let sib = label.nextElementSibling;
    while (sib && !sib.querySelector(".storage-remaining-days"))
      sib = sib.nextElementSibling;
    const days = firstInt(sib?.querySelector(".storage-remaining-days")?.textContent);
    return { days, expired: true };
  }
  return {
    days: firstInt(li.querySelector(".storage-remaining-days")?.textContent),
    expired: false,
  };
}

function invoiceTotalYen(li: Element): number | null {
  const invoice = li.querySelector(".invoice_info");
  if (!invoice) return null;
  const total = findDdForDt(invoice, "Total Amount");
  return parseYenYen(total);
}

function checkboxInvoiceYen(li: Element): number | null {
  const chk = li.querySelector(
    'input[type="checkbox"][name^="mybaggage"]',
  ) as HTMLInputElement | null;
  const v = chk?.getAttribute("data-invoice-total-price");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractOne(li: Element): PackageItem | null {
  const id = li.id?.trim() || li.getAttribute("data-baggageid")?.trim() || "";
  const packageNumber =
    textAfterBoldPackageNumber(li.querySelector(".package_number")) || id;

  const invoice = li.querySelector(".invoice_info");
  let originalValueYen = invoiceTotalYen(li);
  if (originalValueYen == null) originalValueYen = checkboxInvoiceYen(li);

  const weightText = invoice ? findDdForDt(invoice, "Total Weight") : null;
  let weightG = parseWeightG(weightText);

  const dimText = invoice ? findDdForDt(invoice, "Dimensions") : null;
  let dimensionsCm = parseDimensionsCm(dimText);

  if (
    originalValueYen == null ||
    weightG == null ||
    dimensionsCm == null
  ) {
    return null;
  }

  const storage = parseStorage(li);

  return {
    id: id || packageNumber,
    packageNumber,
    itemTitle: firstItemTitle(li),
    itemUrl: itemLinks(li)[0]?.url ?? null,
    lineItems: itemLinks(li),
    originalValueYen,
    weightG,
    dimensionsCm,
    freeStorageDaysLeft: storage.days,
    storageExpired: storage.expired,
  };
}

export function parseBuyeeHtml(html: string): ParseResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes = doc.querySelectorAll("li.luggageInfo");
  const items: PackageItem[] = [];
  const errors: ParseError[] = [];

  let i = 0;
  for (const li of nodes) {
    const packageId =
      li.id?.trim() ||
      li.getAttribute("data-baggageid")?.trim() ||
      `row-${i}`;
    const item = extractOne(li);
    if (item) {
      items.push(item);
    } else {
      errors.push({
        index: i,
        packageId,
        message: "Missing invoice total, weight, or dimensions",
      });
    }
    i++;
  }

  return { items, errors };
}
