import { useEffect, useMemo, useState } from "react";
import { getItemImage, getItemImageError } from "../images";
import type { PackageItem } from "../types/packageItem";
import { valueGbp, volumeCm3 } from "../types/packageItem";
import { JPY_TO_GBP } from "../config";
const EXCLUDED_ASSIGNMENT = 9;

export type SortKey =
  | "packageNumber"
  | "itemTitle"
  | "originalValueYen"
  | "valueGbp"
  | "weightG"
  | "volumeCm3"
  | "freeStorageDaysLeft"
  | "box";

export type SortState = { key: SortKey; dir: "asc" | "desc" };

/**
 * Pastel row tint per box. Uses the golden angle (~137.5°) between consecutive
 * box numbers so nearby boxes (1 vs 2 vs 3) land on distant parts of the hue
 * wheel, not adjacent muddy pastels. Slightly higher chroma than before.
 */
export function boxRowBackground(
  box: number | null | undefined,
): string | undefined {
  if (box == null || box < 1 || !Number.isFinite(box)) return undefined;
  const n = Math.floor(box);
  const GOLDEN_ANGLE = 137.508;
  const hue = ((n - 1) * GOLDEN_ANGLE + 12) % 360;
  return `hsl(${hue} 62% 78%)`;
}

type Props = {
  items: PackageItem[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  assignments: Record<string, number | null | undefined>;
  translations?: Record<string, string>;
};

function cmpNum(
  a: number | null,
  b: number | null,
  dir: "asc" | "desc",
): number {
  const na = a ?? -Infinity;
  const nb = b ?? -Infinity;
  const d = na - nb;
  return dir === "asc" ? d : -d;
}

function cmpStr(a: string, b: string, dir: "asc" | "desc"): number {
  const d = a.localeCompare(b, undefined, { numeric: true });
  return dir === "asc" ? d : -d;
}

export function sortedItems(
  items: PackageItem[],
  sort: SortState,
  assignments: Record<string, number | null | undefined>,
): PackageItem[] {
  const { key, dir } = sort;
  const copy = [...items];
  copy.sort((A, B) => {
    switch (key) {
      case "packageNumber":
        return cmpStr(A.packageNumber, B.packageNumber, dir);
      case "itemTitle":
        return cmpStr(A.itemTitle, B.itemTitle, dir);
      case "originalValueYen":
        return cmpNum(A.originalValueYen, B.originalValueYen, dir);
      case "valueGbp":
        return cmpNum(valueGbp(A, JPY_TO_GBP), valueGbp(B, JPY_TO_GBP), dir);
      case "weightG":
        return cmpNum(A.weightG, B.weightG, dir);
      case "volumeCm3":
        return cmpNum(volumeCm3(A), volumeCm3(B), dir);
      case "freeStorageDaysLeft":
        // Expired items (days until disposal) are the most urgent: sort first.
        return cmpNum(
          A.freeStorageDaysLeft == null ? null : A.freeStorageDaysLeft - (A.storageExpired ? 10000 : 0),
          B.freeStorageDaysLeft == null ? null : B.freeStorageDaysLeft - (B.storageExpired ? 10000 : 0),
          dir,
        );
      case "box": {
        const ba = assignments[A.id] ?? null;
        const bb = assignments[B.id] ?? null;
        const na = ba === EXCLUDED_ASSIGNMENT ? 999 : (ba ?? -1);
        const nb = bb === EXCLUDED_ASSIGNMENT ? 999 : (bb ?? -1);
        return dir === "asc" ? na - nb : nb - na;
      }
      default:
        return 0;
    }
  });
  return copy;
}

function ItemPreview({
  item,
  x,
  y,
  tr,
}: {
  tr: (t: string) => string;
  item: PackageItem;
  x: number;
  y: number;
}) {
  const lines = (item.lineItems?.length
    ? item.lineItems
    : item.itemUrl
      ? [{ title: item.itemTitle, url: item.itemUrl }]
      : []
  ).slice(0, 4);
  const [imgs, setImgs] = useState<(string | null | undefined)[]>([]);
  useEffect(() => {
    let live = true;
    setImgs(lines.map(() => undefined));
    lines.forEach((l, i) =>
      void getItemImage(l.url).then((u) => {
        if (live) setImgs((p) => p.map((v, j) => (j === i ? u : v)));
      }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);
  if (lines.length === 0) return null;
  const left = Math.min(x + 16, window.innerWidth - 280);
  const top = Math.min(y + 16, window.innerHeight - 300);
  return (
    <div
      className="pointer-events-none fixed z-50 flex gap-2 rounded-lg border border-zinc-300 bg-white p-2 shadow-xl"
      style={{ left, top }}
    >
      {lines.map((l, i) => (
        <div key={l.url} className="w-60 text-xs text-zinc-700">
          {imgs[i] ? (
            <img
              src={imgs[i]!}
              referrerPolicy="no-referrer"
              alt=""
              className="h-60 w-60 rounded object-contain bg-zinc-50"
            />
          ) : (
            <div className="flex h-60 w-60 items-center justify-center rounded bg-zinc-100 text-zinc-400">
              {imgs[i] === undefined
                ? "Loading…"
                : `No image (${getItemImageError(l.url) ?? "unknown"})`}
            </div>
          )}
          <p className="mt-1 line-clamp-2">{tr(l.title)}</p>
        </div>
      ))}
    </div>
  );
}

function HeaderBtn({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right" | "center";
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-1 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 hover:bg-zinc-100 ${
        align === "right"
          ? "justify-end text-right"
          : align === "center"
            ? "justify-center text-center"
            : "text-left"
      }`}
      onClick={onClick}
    >
      {label}
      {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );
}

export function PackageTable({
  items,
  sort,
  onSort,
  selectedId,
  onSelect,
  assignments,
  translations = {},
}: Props) {
  const tr = (t: string) => translations[t] ?? t;
  const [hover, setHover] = useState<{ item: PackageItem; x: number; y: number } | null>(null);
  const rows = useMemo(
    () => sortedItems(items, sort, assignments),
    [items, sort, assignments],
  );

  return (
    <div
      tabIndex={0}
      className="outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-100 shadow-sm">
            <tr>
              <th className="border-b border-zinc-200">
                <HeaderBtn
                  label="Package"
                  active={sort.key === "packageNumber"}
                  dir={sort.dir}
                  onClick={() => onSort("packageNumber")}
                />
              </th>
              <th className="border-b border-zinc-200">
                <HeaderBtn
                  label="Item"
                  active={sort.key === "itemTitle"}
                  dir={sort.dir}
                  onClick={() => onSort("itemTitle")}
                />
              </th>
              <th className="border-b border-zinc-200">
                <HeaderBtn
                  label="Yen"
                  active={sort.key === "originalValueYen"}
                  dir={sort.dir}
                  onClick={() => onSort("originalValueYen")}
                  align="right"
                />
              </th>
              <th className="border-b border-zinc-200">
                <HeaderBtn
                  label="GBP"
                  active={sort.key === "valueGbp"}
                  dir={sort.dir}
                  onClick={() => onSort("valueGbp")}
                  align="right"
                />
              </th>
              <th className="border-b border-zinc-200">
                <HeaderBtn
                  label="Weight (g)"
                  active={sort.key === "weightG"}
                  dir={sort.dir}
                  onClick={() => onSort("weightG")}
                  align="right"
                />
              </th>
              <th className="border-b border-zinc-200">
                <HeaderBtn
                  label="Volume (cm³)"
                  active={sort.key === "volumeCm3"}
                  dir={sort.dir}
                  onClick={() => onSort("volumeCm3")}
                  align="right"
                />
              </th>
              <th className="border-b border-zinc-200">
                <HeaderBtn
                  label="Days left"
                  active={sort.key === "freeStorageDaysLeft"}
                  dir={sort.dir}
                  onClick={() => onSort("freeStorageDaysLeft")}
                  align="right"
                />
              </th>
              <th className="border-b border-zinc-200">
                <HeaderBtn
                  label="Box"
                  active={sort.key === "box"}
                  dir={sort.dir}
                  onClick={() => onSort("box")}
                  align="center"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const gbp = valueGbp(item, JPY_TO_GBP);
              const vol = volumeCm3(item);
              const box = assignments[item.id];
              const sel = selectedId === item.id;
              const isExcluded = box === EXCLUDED_ASSIGNMENT;
              const gone = !!item.gone;
              const tint = isExcluded || gone ? undefined : boxRowBackground(box);
              return (
                <tr
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  onMouseMove={(e) =>
                    setHover((h) =>
                      h && h.item.id === item.id
                        ? { ...h, x: e.clientX, y: e.clientY }
                        : { item, x: e.clientX, y: e.clientY },
                    )
                  }
                  onMouseLeave={() => setHover(null)}
                  style={{
                    ...(tint ? { backgroundColor: tint } : {}),
                    boxShadow: sel
                      ? "inset 0 0 0 4px #18181b"
                      : item.storageExpired && !gone
                        ? "inset 6px 0 0 #dc2626"
                        : !gone &&
                            item.freeStorageDaysLeft != null &&
                            item.freeStorageDaysLeft < 10
                          ? "inset 6px 0 0 #facc15"
                          : undefined,
                  }}
                  className={`cursor-pointer border-b border-zinc-100 transition-[background-color,box-shadow,filter] ${
                    gone
                      ? "bg-zinc-100 text-zinc-400 line-through"
                      : tint
                        ? "hover:brightness-[0.97]"
                        : "bg-white hover:bg-zinc-50"
                  }`}
                >
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">
                    {item.packageNumber}
                  </td>
                  <td className="max-w-[280px] truncate px-2 py-1.5" title={item.itemTitle}>
                    {item.itemUrl ? (
                      <a
                        href={item.itemUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className={gone ? "" : "text-sky-700 hover:underline"}
                        title="Open item preview in a new tab"
                      >
                        {tr(item.itemTitle)}
                      </a>
                    ) : (
                      tr(item.itemTitle)
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {item.originalValueYen.toLocaleString("en-GB")}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    £{gbp.toFixed(2)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {item.weightG}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {vol.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {item.storageExpired && !gone ? (
                      <span
                        className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white"
                        title="Free storage has ended — days until disposal"
                      >
                        ⚠ {item.freeStorageDaysLeft ?? "?"}
                      </span>
                    ) : !gone &&
                      item.freeStorageDaysLeft != null &&
                      item.freeStorageDaysLeft < 10 ? (
                      <span
                        className="rounded bg-yellow-400 px-1.5 py-0.5 text-xs font-semibold text-yellow-950"
                        title="Less than 10 free storage days left"
                      >
                        ⚠ {item.freeStorageDaysLeft}
                      </span>
                    ) : (
                      (item.freeStorageDaysLeft ?? "—")
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-center font-medium tabular-nums">
                    {gone ? "gone" : isExcluded ? "EXCL" : box != null ? box : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hover && <ItemPreview tr={tr} item={hover.item} x={hover.x} y={hover.y} />}
    </div>
  );
}
