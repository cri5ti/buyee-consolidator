import { useMemo, useState } from "react";
import type { PackageItem } from "../types/packageItem";
import { valueGbp, volumeCm3 } from "../types/packageItem";
import {
  JPY_TO_GBP,
  MAX_BOX_VALUE_GBP,
  MAX_BOX_WEIGHT_G,
  MIN_BOX_VALUE_GBP,
  SHIPPING_CALC_METHOD,
  SHIPPING_VOLUMETRIC_DIVISOR_CM3_PER_KG,
} from "../config";
import {
  boxValueScoreTerm,
  estimateShippingYenForTotals,
  shippingChargeableWeightKg,
} from "../consolidate/packingUtils";
export const EXCLUDED_ASSIGNMENT = 9;

type BoxStats = {
  box: number;
  itemIds: string[];
  count: number;
  sumGbp: number;
  sumWeightG: number;
  sumVolumeCm3: number;
  volumetricKg: number;
  billableKg: number;
  estShippingYen: number;
  estShippingGbp: number;
  scoreTerm: number;
  ok: boolean;
  valueOver: boolean;
  weightOver: boolean;
  belowMinValue: boolean;
};

/** Buyee luggage console: click each package checkbox in the parcel. */
function buyeeSelectScript(itemIds: string[]): string {
  return itemIds.map((id) => `$('li#${id} .checkbox').click()`).join("\n");
}

type UnassignedStats = {
  count: number;
  sumGbp: number;
  sumWeightG: number;
  sumVolumeCm3: number;
  volumetricKg: number;
  billableKg: number;
  estShippingYen: number;
  estShippingGbp: number;
};

type ExcludedStats = {
  count: number;
  sumGbp: number;
  sumWeightG: number;
  sumVolumeCm3: number;
};

export function aggregate(
  items: PackageItem[],
  assignments: Record<string, number | null | undefined>,
): BoxStats[] {
  const byBox = new Map<
    number,
    { items: PackageItem[] }
  >();

  for (const item of items) {
    const b = assignments[item.id];
    if (b == null || b < 1 || b === EXCLUDED_ASSIGNMENT) continue;
    let g = byBox.get(b);
    if (!g) {
      g = { items: [] };
      byBox.set(b, g);
    }
    g.items.push(item);
  }

  const rows = [...byBox.keys()].map((box) => {
    const list = byBox.get(box)!.items;
    let sumGbp = 0;
    let sumWeightG = 0;
    let sumVolumeCm3 = 0;
    for (const it of list) {
      sumGbp += valueGbp(it, JPY_TO_GBP);
      sumWeightG += it.weightG;
      sumVolumeCm3 += volumeCm3(it);
    }
    const volumetricKg = sumVolumeCm3 / SHIPPING_VOLUMETRIC_DIVISOR_CM3_PER_KG;
    const billableKg = shippingChargeableWeightKg(sumWeightG, sumVolumeCm3);
    const estShippingYen = estimateShippingYenForTotals(sumWeightG, sumVolumeCm3);
    const valueOver = sumGbp > MAX_BOX_VALUE_GBP;
    const weightOver = sumWeightG > MAX_BOX_WEIGHT_G;
    const belowMinValue = sumGbp < MIN_BOX_VALUE_GBP - 1e-6;
    const ok = !valueOver && !weightOver && !belowMinValue;
    return {
      box,
      itemIds: list.map((it) => it.id),
      count: list.length,
      sumGbp,
      sumWeightG,
      sumVolumeCm3,
      volumetricKg,
      billableKg,
      estShippingYen,
      estShippingGbp: estShippingYen * JPY_TO_GBP,
      scoreTerm: boxValueScoreTerm(sumGbp, MAX_BOX_VALUE_GBP),
      ok,
      valueOver,
      weightOver,
      belowMinValue,
    };
  });
  rows.sort((a, b) => a.box - b.box);
  return rows;
}

export function unassignedAggregate(
  items: PackageItem[],
  assignments: Record<string, number | null | undefined>,
): UnassignedStats {
  let count = 0;
  let sumGbp = 0;
  let sumWeightG = 0;
  let sumVolumeCm3 = 0;
  for (const it of items) {
    const b = assignments[it.id];
    if (b === EXCLUDED_ASSIGNMENT) continue;
    if (b != null && b >= 1) continue;
    count++;
    sumGbp += valueGbp(it, JPY_TO_GBP);
    sumWeightG += it.weightG;
    sumVolumeCm3 += volumeCm3(it);
  }
  const volumetricKg = sumVolumeCm3 / SHIPPING_VOLUMETRIC_DIVISOR_CM3_PER_KG;
  const billableKg = shippingChargeableWeightKg(sumWeightG, sumVolumeCm3);
  const estShippingYen = estimateShippingYenForTotals(sumWeightG, sumVolumeCm3);
  return {
    count,
    sumGbp,
    sumWeightG,
    sumVolumeCm3,
    volumetricKg,
    billableKg,
    estShippingYen,
    estShippingGbp: estShippingYen * JPY_TO_GBP,
  };
}

export function excludedAggregate(
  items: PackageItem[],
  assignments: Record<string, number | null | undefined>,
): ExcludedStats {
  let count = 0;
  let sumGbp = 0;
  let sumWeightG = 0;
  let sumVolumeCm3 = 0;
  for (const it of items) {
    if (assignments[it.id] !== EXCLUDED_ASSIGNMENT) continue;
    count++;
    sumGbp += valueGbp(it, JPY_TO_GBP);
    sumWeightG += it.weightG;
    sumVolumeCm3 += volumeCm3(it);
  }
  return { count, sumGbp, sumWeightG, sumVolumeCm3 };
}

export function BoxFooter({
  items,
  assignments,
  onClearAllAssignments,
}: {
  items: PackageItem[];
  assignments: Record<string, number | null | undefined>;
  onClearAllAssignments?: () => void;
}) {
  const stats = useMemo(
    () => aggregate(items, assignments),
    [items, assignments],
  );

  const unassigned = useMemo(
    () => unassignedAggregate(items, assignments),
    [items, assignments],
  );
  const excluded = useMemo(
    () => excludedAggregate(items, assignments),
    [items, assignments],
  );

  const [copiedBox, setCopiedBox] = useState<number | null>(null);

  const canClear = items.some((it) => {
    const b = assignments[it.id];
    return b != null && (b >= 1 || b === EXCLUDED_ASSIGNMENT);
  });
  const totalAssignedEstShippingGbp = stats.reduce(
    (sum, s) => sum + s.estShippingGbp,
    0,
  );

  const onCopySelectScript = async (box: number, itemIds: string[]) => {
    const script = buyeeSelectScript(itemIds);
    try {
      await navigator.clipboard.writeText(script);
      setCopiedBox(box);
      window.setTimeout(() => {
        setCopiedBox((prev) => (prev === box ? null : prev));
      }, 1500);
    } catch {
      // Fallback for restricted clipboard contexts
      window.prompt("Copy this script:", script);
    }
  };

  if (items.length === 0) {
    return (
      <footer className="mt-4 border border-zinc-200 bg-zinc-50 px-4 py-3 text-center text-sm text-zinc-500">
        Import a file to see box totals and unassigned sums.
      </footer>
    );
  }

  const overHighlight =
    "rounded px-1 font-semibold text-red-700 ring-1 ring-red-400/70 bg-red-50";

  return (
    <footer className="mt-4 border border-zinc-200 bg-zinc-50 shadow-sm">
      <div className="min-w-0 px-4 py-2">
        <div className="mb-1 text-xs text-zinc-600">
          Estimated shipping (assigned boxes):{" "}
          <strong>£{totalAssignedEstShippingGbp.toFixed(2)}</strong>
          <span className="ml-2 text-zinc-500">
            (method: {SHIPPING_CALC_METHOD}, EMS Zone 3 table)
          </span>
        </div>
        <div className="flex flex-nowrap items-stretch gap-3 overflow-x-auto pb-1">
          {stats.length === 0 ? (
            <p className="w-[min(100%,16rem)] shrink-0 self-center text-xs text-zinc-500">
              No boxes yet — unassigned totals are on the right →
            </p>
          ) : (
            stats.map((s) => (
              <div
                key={s.box}
                className={`w-[200px] shrink-0 rounded-md border px-3 py-2 text-xs ${
                  s.ok
                    ? "border-emerald-200 bg-emerald-50/80"
                    : s.belowMinValue
                      ? "border-amber-300 bg-amber-50/90"
                      : "border-zinc-200 bg-white"
                }`}
              >
                <div className="font-semibold text-zinc-800">Box {s.box}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-zinc-700">
                  <span>Items</span>
                  <span className="text-right tabular-nums">{s.count}</span>
                  <span>Value</span>
                  <span
                    className={`text-right tabular-nums ${
                      s.valueOver ? overHighlight : ""
                    }`}
                  >
                    £{s.sumGbp.toFixed(2)}
                  </span>
                  <span>Score</span>
                  <span
                    className={`text-right tabular-nums ${
                      s.belowMinValue ? "font-semibold text-amber-900" : ""
                    }`}
                    title="(value ÷ £cap)² — same term as the genetic fitness"
                  >
                    {s.scoreTerm.toFixed(3)}
                  </span>
                  <span>Weight</span>
                  <span
                    className={`text-right tabular-nums ${
                      s.weightOver ? overHighlight : ""
                    }`}
                  >
                    {s.sumWeightG} g
                  </span>
                  <span>Volume</span>
                  <span className="text-right tabular-nums">
                    {s.sumVolumeCm3.toLocaleString("en-GB", {
                      maximumFractionDigits: 0,
                    })}{" "}
                    cm³
                  </span>
                  <span>Vol. wt</span>
                  <span className="text-right tabular-nums">
                    {s.volumetricKg.toFixed(2)} kg
                  </span>
                  <span>Billable</span>
                  <span className="text-right tabular-nums">
                    {s.billableKg.toFixed(2)} kg
                  </span>
                  <span>Ship est</span>
                  <span className="text-right tabular-nums font-medium">
                    £{s.estShippingGbp.toFixed(2)}
                  </span>
                </div>
                {s.belowMinValue && (
                  <p className="mt-1 text-[10px] leading-tight text-amber-900">
                    Below min £{MIN_BOX_VALUE_GBP}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onCopySelectScript(s.box, s.itemIds)}
                  className="mt-2 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 hover:bg-zinc-50"
                  title="Copy jQuery to select these packages in the Buyee console"
                >
                  {copiedBox === s.box ? "Copied!" : "Copy select script"}
                </button>
              </div>
            ))
          )}

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-stretch">
            {excluded.count > 0 && (
              <div className="w-[200px] shrink-0 rounded-md border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs">
                <div className="font-semibold text-zinc-800">Excluded</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-zinc-700">
                  <span>Items</span>
                  <span className="text-right tabular-nums">{excluded.count}</span>
                  <span>Value</span>
                  <span className="text-right tabular-nums">£{excluded.sumGbp.toFixed(2)}</span>
                  <span>Weight</span>
                  <span className="text-right tabular-nums">{excluded.sumWeightG} g</span>
                  <span>Volume</span>
                  <span className="text-right tabular-nums">
                    {excluded.sumVolumeCm3.toLocaleString("en-GB", {
                      maximumFractionDigits: 0,
                    })}{" "}
                    cm³
                  </span>
                </div>
              </div>
            )}
            <div className="w-[200px] shrink-0 rounded-md border border-dashed border-zinc-300 bg-zinc-100/70 px-3 py-2 text-xs">
              <div className="font-semibold text-zinc-800">Unassigned</div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-zinc-700">
                <span>Items</span>
                <span className="text-right tabular-nums">
                  {unassigned.count}
                </span>
                <span>Value</span>
                <span className="text-right tabular-nums">
                  £{unassigned.sumGbp.toFixed(2)}
                </span>
                <span>Weight</span>
                <span className="text-right tabular-nums">
                  {unassigned.sumWeightG} g
                </span>
                <span>Volume</span>
                <span className="text-right tabular-nums">
                  {unassigned.sumVolumeCm3.toLocaleString("en-GB", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  cm³
                </span>
                <span>Vol. wt</span>
                <span className="text-right tabular-nums">
                  {unassigned.volumetricKg.toFixed(2)} kg
                </span>
                <span>Billable</span>
                <span className="text-right tabular-nums">
                  {unassigned.billableKg.toFixed(2)} kg
                </span>
                <span>Ship est</span>
                <span className="text-right tabular-nums font-medium">
                  £{unassigned.estShippingGbp.toFixed(2)}
                </span>
              </div>
            </div>
            {onClearAllAssignments && (
              <button
                type="button"
                onClick={onClearAllAssignments}
                disabled={!canClear}
                className="h-fit shrink-0 self-start rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
              >
                Clear all assignments
              </button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
