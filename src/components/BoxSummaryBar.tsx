import { useMemo } from "react";
import type { PackageItem } from "../types/packageItem";
import {
  aggregate,
  excludedAggregate,
  unassignedAggregate,
} from "./BoxFooter";

const overHighlight =
  "rounded px-1 font-semibold text-red-700 ring-1 ring-red-400/70 bg-red-50";

/**
 * Compact sticky version of BoxFooter: just box number, value and weight, with
 * the same cards/colours. App hides it while the full BoxFooter is on screen.
 */
export function BoxSummaryBar({
  items,
  assignments,
}: {
  items: PackageItem[];
  assignments: Record<string, number | null | undefined>;
}) {
  const stats = useMemo(() => aggregate(items, assignments), [items, assignments]);
  const unassigned = useMemo(
    () => unassignedAggregate(items, assignments),
    [items, assignments],
  );
  const excluded = useMemo(
    () => excludedAggregate(items, assignments),
    [items, assignments],
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-300 bg-zinc-50/95 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] backdrop-blur">
      <div className="flex flex-nowrap items-stretch gap-2 overflow-x-auto px-4 py-2">
        {stats.map((s) => (
          <div
            key={s.box}
            className={`w-[150px] shrink-0 rounded-md border px-3 py-1.5 text-xs ${
              s.ok
                ? "border-emerald-200 bg-emerald-50/80"
                : s.belowMinValue
                  ? "border-amber-300 bg-amber-50/90"
                  : "border-zinc-200 bg-white"
            }`}
          >
            <div className="font-semibold text-zinc-800">Box {s.box}</div>
            <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-zinc-700">
              <span>Value</span>
              <span className={`text-right tabular-nums ${s.valueOver ? overHighlight : ""}`}>
                £{s.sumGbp.toFixed(2)}
              </span>
              <span>Weight</span>
              <span className={`text-right tabular-nums ${s.weightOver ? overHighlight : ""}`}>
                {s.sumWeightG} g
              </span>
            </div>
          </div>
        ))}
        {excluded.count > 0 && (
          <div className="w-[150px] shrink-0 rounded-md border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs">
            <div className="font-semibold text-zinc-800">Excluded</div>
            <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-zinc-700">
              <span>Value</span>
              <span className="text-right tabular-nums">£{excluded.sumGbp.toFixed(2)}</span>
              <span>Weight</span>
              <span className="text-right tabular-nums">{excluded.sumWeightG} g</span>
            </div>
          </div>
        )}
        <div className="w-[150px] shrink-0 rounded-md border border-dashed border-zinc-300 bg-zinc-100/70 px-3 py-1.5 text-xs">
          <div className="font-semibold text-zinc-800">Unassigned</div>
          <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-zinc-700">
            <span>Value</span>
            <span className="text-right tabular-nums">£{unassigned.sumGbp.toFixed(2)}</span>
            <span>Weight</span>
            <span className="text-right tabular-nums">{unassigned.sumWeightG} g</span>
          </div>
        </div>
      </div>
    </div>
  );
}
