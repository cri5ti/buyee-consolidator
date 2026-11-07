/**
 * Resolves a Buyee item page URL to a picture URL (og:image etc.). The fetch
 * runs from the extension page, where buyee.jp host permission bypasses CORS.
 */
const KEY = "buyeeConsolidator.images.v1";
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();
let loaded: Promise<void> | null = null;

const hasChrome = () => typeof chrome !== "undefined" && !!chrome.storage?.local;

function ensureLoaded(): Promise<void> {
  loaded ??= (async () => {
    try {
      const raw: Record<string, string> | null = hasChrome()
        ? (((await chrome.storage.local.get(KEY))[KEY] as
            | Record<string, string>
            | undefined) ?? null)
        : JSON.parse(localStorage.getItem(KEY) ?? "null");
      for (const [k, v] of Object.entries(raw ?? {})) cache.set(k, v);
    } catch {
      /* ignore */
    }
  })();
  return loaded;
}

function persist() {
  const obj: Record<string, string> = {};
  for (const [k, v] of cache) if (v) obj[k] = v;
  try {
    if (hasChrome()) void chrome.storage.local.set({ [KEY]: obj });
    else localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

const errors = new Map<string, string>();
export const getItemImageError = (url: string) => errors.get(url) ?? null;

const isChallenge = (html: string) =>
  /awsWafCookieDomainList|AwsWafIntegration|challenge\.js/.test(html) &&
  !/og:image/.test(html);

/**
 * Buyee sits behind an AWS WAF bot check, so a bare fetch gets a challenge
 * page. Fetching from inside an open buyee.jp tab reuses that tab's WAF token
 * and cookies, so try that first, then a direct credentialed fetch.
 */
async function fetchPageHtml(url: string): Promise<string> {
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.scripting) {
    try {
      const tabs = await chrome.tabs.query({ url: "https://buyee.jp/*" });
      const tab = tabs.find((t) => t.id != null && !t.discarded);
      if (tab?.id != null) {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async (u: string) => {
            const res = await fetch(u, { credentials: "include" });
            return { status: res.status, html: await res.text() };
          },
          args: [url],
        });
        const v = r?.result;
        if (v && v.status === 200 && !isChallenge(v.html)) return v.html;
      }
    } catch {
      /* fall through */
    }
  }
  const res = await fetch(url, { credentials: "include" });
  const html = await res.text();
  if (res.status !== 200 || isChallenge(html))
    throw new Error(`blocked (HTTP ${res.status}) — open a buyee.jp tab`);
  return html;
}

function extractImage(html: string, base: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const metas = [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'link[rel="image_src"]',
  ];
  for (const sel of metas) {
    const el = doc.querySelector(sel);
    const v = el?.getAttribute("content") ?? el?.getAttribute("href");
    if (v) return new URL(v, base).toString();
  }
  const img = doc.querySelector<HTMLImageElement>(
    '.item_image img, .itemPhoto img, #itemPhoto img, .main_image img, .js-item-image, [class*="item"] img[src^="http"]',
  );
  const src = img?.getAttribute("src") ?? img?.getAttribute("data-src");
  if (src) return new URL(src, base).toString();
  const m = html.match(
    /https?:\/\/[^"'\s\\]*(?:mercdn\.net|media-amazon\.com|images-na\.ssl-images-amazon\.com)[^"'\s\\]*\.(?:jpe?g|png|webp)[^"'\s\\]*/i,
  );
  return m ? m[0] : null;
}

export function getItemImage(url: string): Promise<string | null> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(url);
  if (!p) {
    p = ensureLoaded()
      .then(async () => {
        if (cache.get(url)) return cache.get(url)!;
        const img = extractImage(await fetchPageHtml(url), url);
        if (img) {
          cache.set(url, img);
          errors.delete(url);
          persist();
        } else errors.set(url, "no image on page");
        return img;
      })
      .catch((e) => {
        errors.set(url, e instanceof Error ? e.message : String(e));
        return null;
      })
      .finally(() => pending.delete(url));
    pending.set(url, p);
  }
  return p;
}
