import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseBuyeeHtml } from "./parse/buyeeHtml";
import type { PackageItem } from "./types/packageItem";
import { ImportDropzone } from "./components/ImportDropzone";
import {
  PackageTable,
  sortedItems,
  type SortKey,
  type SortState,
} from "./components/PackageTable";
import { BoxFooter } from "./components/BoxFooter";
import { BoxSummaryBar } from "./components/BoxSummaryBar";
import {
  runGreedyOptimize,
  type OptimizeState,
} from "./consolidate/greedyOptimize";
import { validateItemsForPacking, suggestedBoxCount, MAX_TARGET_BOXES } from "./consolidate/packingUtils";
import { MAX_BOX_WEIGHT_G, DEFAULT_SETTINGS, applySettings, type Settings } from "./config";
import { SettingsPanel } from "./components/SettingsPanel";
import { loadState, saveState, clearState, loadSettings, saveSettings } from "./storage";
import { mergeScan } from "./merge";
import { scanBuyeeTab } from "./scan";
import {
  loadTranslations,
  needsTranslation,
  translateTitles,
  translatorAvailability,
} from "./translate";

const inExtension = typeof chrome !== "undefined" && !!chrome.tabs;

const defaultSort: SortState = {
  key: "packageNumber",
  dir: "asc",
};
const EXCLUDED_ASSIGNMENT = 9;

function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXT" || tag === "SELECT")
    return true;
  return t.isContentEditable;
}

function applyOptimizeState(
  items: PackageItem[],
  s: OptimizeState,
  prev: Record<string, number | null>,
): Record<string, number | null> {
  const next: Record<string, number | null> = { ...prev };
  for (const it of items) {
    next[it.id] = s.assignments[it.id] ?? null;
  }
  return next;
}

export default function App() {
  const [items, setItems] = useState<PackageItem[]>([]);
  const [parseErrors, setParseErrors] = useState<
    { index: number; packageId: string; message: string }[]
  >([]);
  const [sort, setSort] = useState<SortState>(defaultSort);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<
    Record<string, number | null>
  >({});
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [optRunning, setOptRunning] = useState(false);
  const [optGeneration, setOptGeneration] = useState(0);
  const [optBestScore, setOptBestScore] = useState<number | null>(null);
  const [targetBoxes, setTargetBoxes] = useState(1);

  const [hydrated, setHydrated] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  // Bumped whenever limits change so memoised totals/tables recompute.
  const [settingsVersion, setSettingsVersion] = useState(0);

  const onSettingsChange = useCallback((next: Settings) => {
    applySettings(next);
    setSettings(next);
    setSettingsVersion((v) => v + 1);
    void saveSettings(next);
  }, []);

  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [showEnglish, setShowEnglish] = useState(true);
  const [translating, setTranslating] = useState(false);

  const optAbortRef = useRef<AbortController | null>(null);

  // Sticky summary bar shows only while the full footer is off screen.
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [footerVisible, setFooterVisible] = useState(false);
  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setFooterVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const runTranslate = useCallback(
    async (list: PackageItem[], cache: Record<string, string>) => {
      const titles = list.flatMap((i) =>
        i.lineItems?.length ? i.lineItems.map((l) => l.title) : [i.itemTitle],
      );
      if (!titles.some((t) => needsTranslation(t) && !cache[t])) return;
      setTranslating(true);
      try {
        const out = await translateTitles(
          titles,
          cache,
          (done, total, c) => {
            setTranslations(c);
            setScanMessage(`Translating titles ${done}/${total}…`);
          },
          (f) => setScanMessage(`Downloading translation model ${Math.round(f * 100)}%…`),
        );
        setTranslations(out);
        setScanMessage(null);
      } catch (e) {
        setScanMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setTranslating(false);
      }
    },
    [],
  );

  // Load cached translations; auto-translate new titles when the model is
  // already installed (no click needed in that case).
  useEffect(() => {
    if (!hydrated) return;
    void (async () => {
      const cache = await loadTranslations();
      setTranslations(cache);
      if ((await translatorAvailability()) === "available")
        void runTranslate(items, cache);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, items.length]);

  // Items still listed on Buyee; "gone" ones are history only.
  const activeItems = useMemo(() => items.filter((i) => !i.gone), [items]);
  const goneCount = items.length - activeItems.length;

  // Restore saved plan.
  useEffect(() => {
    void loadSettings().then((st) => {
      applySettings(st);
      setSettings(st);
      setSettingsVersion((v) => v + 1);
    });
    void loadState().then((st) => {
      if (st) {
        setItems(st.items);
        setAssignments(st.assignments);
        setTargetBoxes(st.targetBoxes || 1);
        setLastScanAt(st.lastScanAt);
        setSelectedId(st.items.find((i) => !i.gone)?.id ?? null);
      }
      setHydrated(true);
    });
  }, []);

  // Persist on every change (after the initial restore).
  useEffect(() => {
    if (!hydrated) return;
    void saveState({ items, assignments, targetBoxes, lastScanAt });
  }, [hydrated, items, assignments, targetBoxes, lastScanAt]);

  const onLoadHtml = useCallback(
    (html: string) => {
      const { items: scanned, errors } = parseBuyeeHtml(html);
      setParseErrors(errors);
      if (scanned.length === 0) {
        setScanMessage("No packages found in that HTML.");
        return;
      }
      const m = mergeScan(items, scanned);
      setItems(m.items);
      setLastScanAt(Date.now());
      if (items.length === 0) setTargetBoxes(suggestedBoxCount(scanned));
      setSelectedId((cur) => cur ?? scanned[0]?.id ?? null);
      setScanMessage(
        `Merged ${scanned.length} packages: ${m.added} new, ${m.gone} gone, ${m.revived} back.`,
      );
    },
    [items],
  );

  const onScan = useCallback(async () => {
    setScanning(true);
    setScanMessage("Scanning Buyee tab (loading all packages)…");
    try {
      const r = await scanBuyeeTab();
      onLoadHtml(`<ul>${r.html}</ul>`);
      setScanMessage((prev) =>
        r.count === 0
          ? "Buyee tab has no packages — is it the luggage page?"
          : `${prev ?? ""} (${r.count} on page, ${r.clicks} “load more” click${r.clicks === 1 ? "" : "s"}${r.loadMoreFound ? "" : "; no load-more button found"})`,
      );
    } catch (e) {
      setScanMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [onLoadHtml]);

  const onNew = useCallback(() => {
    if (
      items.length > 0 &&
      !window.confirm("Clear everything (packages and box assignments) and start fresh?")
    )
      return;
    optAbortRef.current?.abort();
    optAbortRef.current = null;
    setOptRunning(false);
    setItems([]);
    setParseErrors([]);
    setAssignments({});
    setAutoMessage(null);
    setOptGeneration(0);
    setOptBestScore(null);
    setTargetBoxes(1);
    setSelectedId(null);
    setSort(defaultSort);
    setLastScanAt(null);
    setScanMessage(null);
    void clearState();
  }, [items.length]);

  const onClearAllAssignments = useCallback(() => {
    optAbortRef.current?.abort();
    optAbortRef.current = null;
    setOptRunning(false);
    setAssignments({});
    setAutoMessage(null);
    setOptGeneration(0);
    setOptBestScore(null);
  }, []);

  const onStopOptimize = useCallback(() => {
    optAbortRef.current?.abort();
    optAbortRef.current = null;
    setOptRunning(false);
    setAutoMessage((prev) =>
      prev?.startsWith("Opt")
        ? `${prev} — stopped.`
        : prev ?? "Optimization stopped.",
    );
  }, []);

  const onStartAutoAssign = useCallback(() => {
    if (activeItems.length === 0 || optRunning) return;
    const targetItems = activeItems.filter(
      (it) => assignments[it.id] !== EXCLUDED_ASSIGNMENT,
    );
    if (targetItems.length === 0) {
      setAutoMessage("All items are excluded.");
      return;
    }

    const bad = validateItemsForPacking(targetItems);
    if (bad) {
      setAutoMessage(bad);
      return;
    }

    const n = Math.max(
      1,
      Math.min(MAX_TARGET_BOXES, Math.floor(targetBoxes) || 1, targetItems.length),
    );
    if (n !== targetBoxes) setTargetBoxes(n);

    optAbortRef.current?.abort();
    const ac = new AbortController();
    optAbortRef.current = ac;
    setOptRunning(true);
    setAutoMessage("Opt: starting greedy…");

    void runGreedyOptimize(
      targetItems,
      (s) => {
        setOptGeneration(s.generation);
        setOptBestScore(s.bestScore);
        setAssignments((prev) => applyOptimizeState(targetItems, s, prev));
        const left = targetItems.length - s.assignedCount;
        setAutoMessage(
          `Opt gen ${s.generation} — target ${s.targetBoxes} box${s.targetBoxes === 1 ? "" : "es"} — ${s.boxesUsed} used, ${s.assignedCount}/${targetItems.length} packed, ${left} unassigned`,
        );
      },
      ac.signal,
      n,
    ).finally(() => {
      setOptRunning(false);
      optAbortRef.current = null;
    });
  }, [activeItems, assignments, optRunning, targetBoxes]);

  const onSort = useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }, []);

  useEffect(() => {
    return () => {
      optAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (items.length === 0) return;

    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const ordered = sortedItems(items, sort, assignments);
        const ids = ordered.map((i) => i.id);
        const cur = selectedId ? ids.indexOf(selectedId) : -1;
        let next = cur;
        if (e.key === "ArrowDown") {
          next = cur < 0 ? 0 : Math.min(cur + 1, ids.length - 1);
        } else {
          next = cur <= 0 ? 0 : cur - 1;
        }
        const nid = ids[next];
        if (nid) setSelectedId(nid);
        return;
      }

      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        if (!selectedId || items.find((i) => i.id === selectedId)?.gone) return;
        setAssignments((prev) => ({
          ...prev,
          [selectedId]: EXCLUDED_ASSIGNMENT,
        }));
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const n = Number(e.key);
        if (!selectedId || items.find((i) => i.id === selectedId)?.gone) return;
        setAssignments((prev) => ({
          ...prev,
          [selectedId]:
            n === 0
              ? null
              : n === EXCLUDED_ASSIGNMENT
                ? EXCLUDED_ASSIGNMENT
                : Math.max(1, Math.min(8, n)),
        }));
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, sort, assignments, selectedId]);

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-900">
          Buyee consolidator
        </h1>
        {inExtension && (
          <button
            type="button"
            onClick={() => void onScan()}
            disabled={scanning}
            className="rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-sky-600 disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Scan Buyee"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void runTranslate(items, translations)}
          disabled={translating || items.length === 0}
          className="rounded-md border border-zinc-400 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
        >
          {translating ? "Translating…" : "Translate titles"}
        </button>
        <label className="flex items-center gap-1 text-xs text-zinc-700">
          <input
            type="checkbox"
            checked={showEnglish}
            onChange={(e) => setShowEnglish(e.target.checked)}
          />
          English
        </label>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="rounded-md border border-zinc-400 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
        >
          Settings
        </button>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md border border-zinc-400 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
        >
          New
        </button>
        <p className="text-xs text-zinc-600">
          ↑/↓ move · <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 font-mono">1</kbd>–
          <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 font-mono">8</kbd> box ·{" "}
          <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 font-mono">x</kbd> exclude ·{" "}
          <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 font-mono">0</kbd> clear · caps ≤{MAX_BOX_WEIGHT_G} g / £{settings.maxBoxValueGbp}
        </p>
        {lastScanAt && (
          <span className="ml-auto text-xs text-zinc-500">
            Last scan {new Date(lastScanAt).toLocaleString()}
          </span>
        )}
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6">
        {showSettings && (
          <SettingsPanel settings={settings} onChange={onSettingsChange} />
        )}
        {scanMessage && (
          <p className="mb-3 text-sm text-zinc-700" role="status">
            {scanMessage}
          </p>
        )}
        {items.length === 0 && <ImportDropzone onLoadHtml={onLoadHtml} />}

        {parseErrors.length > 0 && (
          <div
            className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            role="status"
          >
            <strong>{parseErrors.length}</strong> package(s) skipped (missing
            data):{" "}
            {parseErrors
              .slice(0, 5)
              .map((e) => `${e.packageId} (${e.message})`)
              .join("; ")}
            {parseErrors.length > 5 ? "…" : ""}
          </div>
        )}

        {items.length === 0 ? (
          <p className="mt-8 text-center text-sm text-zinc-500">
            No packages loaded yet.
          </p>
        ) : (
          <div className="mt-6">
            <p className="mb-3 text-sm text-zinc-600">
              <strong>{activeItems.length}</strong> packages
              {goneCount > 0 ? ` (+${goneCount} gone)` : ""} — select a row and
              use keyboard shortcuts.
            </p>
            <PackageTable
              key={settingsVersion}
              items={items}
              sort={sort}
              onSort={onSort}
              selectedId={selectedId}
              onSelect={setSelectedId}
              assignments={assignments}
              translations={showEnglish ? translations : {}}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                Boxes
                <input
                  type="number"
                  min={1}
                  max={Math.min(MAX_TARGET_BOXES, activeItems.length)}
                  value={targetBoxes}
                  disabled={optRunning}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    setTargetBoxes(
                      Math.max(
                        1,
                        Math.min(MAX_TARGET_BOXES, activeItems.length, Math.floor(v)),
                      ),
                    );
                  }}
                  className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm tabular-nums shadow-sm disabled:opacity-50"
                />
              </label>
              <button
                type="button"
                onClick={onStartAutoAssign}
                disabled={optRunning}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Auto-assign
              </button>
              <button
                type="button"
                onClick={onStopOptimize}
                disabled={!optRunning}
                className="rounded-md border border-zinc-400 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Stop
              </button>
              {optRunning && (
                <span className="text-xs text-zinc-500">
                  Gen {optGeneration}
                  {optBestScore != null
                    ? ` · score ${optBestScore.toFixed(2)}`
                    : ""}
                </span>
              )}
            </div>
            {autoMessage && (
              <p
                className={`mt-2 text-sm ${
                  autoMessage.startsWith("Over ") ||
                  autoMessage.includes("Over single-box")
                    ? "text-red-700"
                    : "text-emerald-900"
                }`}
                role="status"
              >
                {autoMessage}
              </p>
            )}
          </div>
        )}
      </main>

      <div ref={footerRef}>
        <BoxFooter
          key={settingsVersion}
          items={activeItems}
          assignments={assignments}
          onClearAllAssignments={onClearAllAssignments}
        />
      </div>
      {activeItems.length > 0 && !footerVisible && (
        <BoxSummaryBar key={settingsVersion} items={activeItems} assignments={assignments} />
      )}
    </div>
  );
}
