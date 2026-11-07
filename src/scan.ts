/**
 * Reads packages straight from an open buyee.jp tab. The function passed to
 * executeScript runs inside the page, so it must be fully self-contained.
 */
export type ScanResult = {
  html: string;
  count: number;
  clicks: number;
  loadMoreFound: boolean;
  tabUrl: string;
};

async function pageScan(): Promise<Omit<ScanResult, "tabUrl">> {
  const LI = "li.luggageInfo";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const count = () => document.querySelectorAll(LI).length;

  const isVisible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const findLoadMore = (): HTMLElement | null => {
    const cands = document.querySelectorAll<HTMLElement>(
      'a, button, input[type="button"], [role="button"]',
    );
    for (const el of cands) {
      if (el.closest(LI) || el.closest(".more_view")) continue;
      if (el.hasAttribute("disabled")) continue;
      const text = (
        el instanceof HTMLInputElement ? el.value : el.textContent || ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!/^(load|show|view|see)?\s*more( packages| items| results)?$/i.test(text))
        continue;
      if (!isVisible(el)) continue;
      return el;
    }
    return null;
  };

  let clicks = 0;
  let loadMoreFound = false;
  for (let i = 0; i < 40; i++) {
    const btn = findLoadMore();
    if (!btn) break;
    loadMoreFound = true;
    const before = count();
    btn.scrollIntoView({ block: "center" });
    btn.click();
    clicks++;
    let grew = false;
    for (let t = 0; t < 40; t++) {
      await sleep(250);
      if (count() > before) {
        grew = true;
        break;
      }
    }
    if (!grew) break;
    await sleep(300);
  }

  const html = Array.from(document.querySelectorAll(LI))
    .map((li) => li.outerHTML)
    .join("\n");
  return { html, count: count(), clicks, loadMoreFound };
}

export async function scanBuyeeTab(): Promise<ScanResult> {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) {
    throw new Error("Scanning only works inside the Chrome extension.");
  }
  const tabs = await chrome.tabs.query({ url: "https://buyee.jp/*" });
  const tab =
    tabs.find((t) => /baggage/i.test(t.url ?? "")) ?? tabs[0] ?? null;
  if (!tab?.id) {
    throw new Error(
      "No buyee.jp tab found. Open your Buyee luggage page and try again.",
    );
  }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pageScan,
  });
  const r = res?.result;
  if (!r) throw new Error("Could not read the Buyee tab.");
  return { ...r, tabUrl: tab.url ?? "" };
}
