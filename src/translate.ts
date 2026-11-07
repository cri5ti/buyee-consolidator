/**
 * Japanese → English via Chrome's on-device Translator API (Chrome 138+).
 * Translations are cached by source text so each title is translated once.
 */
const KEY = "buyeeConsolidator.translations.v1";
const JP = /[぀-ヿ㐀-鿿]/;

type TranslatorLike = { translate(text: string): Promise<string> };
type TranslatorCtor = {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<TranslatorLike>;
};

const ctor = (): TranslatorCtor | null =>
  (self as unknown as { Translator?: TranslatorCtor }).Translator ?? null;

const hasChrome = () => typeof chrome !== "undefined" && !!chrome.storage?.local;

export const needsTranslation = (t: string) => JP.test(t);

export async function loadTranslations(): Promise<Record<string, string>> {
  try {
    if (hasChrome())
      return ((await chrome.storage.local.get(KEY))[KEY] as Record<string, string>) ?? {};
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

async function save(t: Record<string, string>) {
  try {
    if (hasChrome()) await chrome.storage.local.set({ [KEY]: t });
    else localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

export type Availability = "unsupported" | "unavailable" | "downloadable" | "downloading" | "available";

export async function translatorAvailability(): Promise<Availability> {
  const T = ctor();
  if (!T) return "unsupported";
  try {
    return (await T.availability({ sourceLanguage: "ja", targetLanguage: "en" })) as Availability;
  } catch {
    return "unsupported";
  }
}

/**
 * Translates every title not already cached. Must be called from a user click
 * the first time (model download needs user activation). Returns the full cache.
 */
export async function translateTitles(
  titles: string[],
  cache: Record<string, string>,
  onProgress?: (done: number, total: number, cache: Record<string, string>) => void,
  onDownload?: (fraction: number) => void,
): Promise<Record<string, string>> {
  const T = ctor();
  if (!T) throw new Error("Chrome's Translator API isn't available (needs Chrome 138+).");
  const todo = [...new Set(titles)].filter((t) => needsTranslation(t) && !cache[t]);
  const out = { ...cache };
  if (todo.length === 0) return out;
  const translator = await T.create({
    sourceLanguage: "ja",
    targetLanguage: "en",
    monitor: (m) =>
      m.addEventListener("downloadprogress", (e) =>
        onDownload?.((e as Event & { loaded: number }).loaded),
      ),
  });
  let done = 0;
  for (const t of todo) {
    try {
      out[t] = (await translator.translate(t)).trim();
    } catch {
      /* leave untranslated */
    }
    done++;
    if (done % 5 === 0 || done === todo.length) {
      onProgress?.(done, todo.length, out);
      await save(out);
    }
  }
  await save(out);
  return out;
}
