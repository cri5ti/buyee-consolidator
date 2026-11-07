import type { PackageItem } from "./types/packageItem";
import { DEFAULT_SETTINGS, type Settings } from "./config";

export type Persisted = {
  items: PackageItem[];
  assignments: Record<string, number | null>;
  targetBoxes: number;
  lastScanAt: number | null;
};

const KEY = "buyeeConsolidator.v1";

const hasChrome = () =>
  typeof chrome !== "undefined" && !!chrome.storage?.local;

export async function loadState(): Promise<Persisted | null> {
  try {
    if (hasChrome()) {
      const r = await chrome.storage.local.get(KEY);
      return (r[KEY] as Persisted | undefined) ?? null;
    }
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

export async function saveState(s: Persisted): Promise<void> {
  try {
    if (hasChrome()) await chrome.storage.local.set({ [KEY]: s });
    else localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / unavailable storage */
  }
}

export async function clearState(): Promise<void> {
  try {
    if (hasChrome()) await chrome.storage.local.remove(KEY);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const SETTINGS_KEY = "buyeeConsolidator.settings.v1";

export async function loadSettings(): Promise<Settings> {
  try {
    const raw: Partial<Settings> | null = hasChrome()
      ? (((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as
          | Partial<Settings>
          | undefined) ?? null)
      : JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    if (hasChrome()) await chrome.storage.local.set({ [SETTINGS_KEY]: s });
    else localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
