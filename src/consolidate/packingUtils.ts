import type { PackageItem } from "../types/packageItem";
import { valueGbp, volumeCm3 } from "../types/packageItem";
import {
  EMS_ZONE3_RATES,
  JPY_TO_GBP,
  MAX_BOX_VALUE_GBP,
  MAX_BOX_WEIGHT_G,
  SHIPPING_CALC_METHOD,
  SHIPPING_VOLUMETRIC_DIVISOR_CM3_PER_KG,
} from "../config";

/** Per-box score term (footer + fitness): (value / £cap)² */
export function boxValueScoreTerm(sumGbp: number, maxV: number): number {
  const u = sumGbp / maxV;
  return u * u;
}

export function stripBoxesBelowMinValue(
  assignments: Record<string, number>,
  items: PackageItem[],
  rate: number,
  minV: number,
): Record<string, number> {
  const byBox = new Map<number, number>();
  for (const it of items) {
    const b = assignments[it.id];
    if (b == null || b < 1) continue;
    byBox.set(b, (byBox.get(b) ?? 0) + valueGbp(it, rate));
  }
  const keep = new Set<number>();
  for (const [box, sumV] of byBox) {
    if (sumV >= minV - 1e-6) keep.add(box);
  }
  const partial: Record<string, number> = {};
  for (const it of items) {
    const b = assignments[it.id];
    if (b == null || b < 1) continue;
    if (keep.has(b)) partial[it.id] = b;
  }
  const used = [...new Set(Object.values(partial))].sort((a, b) => a - b);
  const map = new Map(used.map((old, i) => [old, i + 1]));
  const out: Record<string, number> = {};
  for (const id of Object.keys(partial)) {
    out[id] = map.get(partial[id]!)!;
  }
  return out;
}

/**
 * Soft £ penalty for uneven box weights (secondary to shipping).
 * Full spread (one empty-ish box vs one at the weight cap) costs ~this amount.
 */
const WEIGHT_IMBALANCE_PENALTY_GBP = 1.5;

/** Manual assign keys are 1–8; keep auto-assign in the same range. */
export const MAX_TARGET_BOXES = 8;

/** Minimum boxes needed by value/weight caps (clamped to item count / max). */
export function suggestedBoxCount(items: PackageItem[]): number {
  if (items.length === 0) return 1;
  const rate = JPY_TO_GBP;
  const totalV = items.reduce((s, it) => s + valueGbp(it, rate), 0);
  const totalW = items.reduce((s, it) => s + it.weightG, 0);
  const byV = Math.ceil(totalV / MAX_BOX_VALUE_GBP - 1e-12);
  const byW = Math.ceil(totalW / MAX_BOX_WEIGHT_G - 1e-12);
  return Math.max(
    1,
    Math.min(MAX_TARGET_BOXES, items.length, Math.max(byV, byW, 1)),
  );
}

export function weightImbalancePenaltyGbp(
  weightsG: number[],
  maxW: number,
): number {
  if (weightsG.length < 2 || maxW <= 0) return 0;
  let minW = Infinity;
  let maxBoxW = -Infinity;
  for (const w of weightsG) {
    if (w < minW) minW = w;
    if (w > maxBoxW) maxBoxW = w;
  }
  return ((maxBoxW - minW) / maxW) * WEIGHT_IMBALANCE_PENALTY_GBP;
}

export function fitnessFromAssignments(
  assignments: Record<string, number>,
  items: PackageItem[],
  rate: number,
  maxV: number,
  maxW: number,
  minBoxV: number,
  targetBoxes?: number,
): number {
  const loads = new Map<number, { v: number; w: number; vol: number }>();
  let assignedCount = 0;
  for (const it of items) {
    const b = assignments[it.id];
    if (b == null || b < 1) continue;
    assignedCount++;
    const L = loads.get(b) ?? { v: 0, w: 0, vol: 0 };
    L.v += valueGbp(it, rate);
    L.w += it.weightG;
    L.vol += volumeCm3(it);
    loads.set(b, L);
  }
  if (loads.size === 0) return -1e9;

  const unassigned = items.length - assignedCount;
  if (unassigned > 0) {
    return -2e8 - unassigned * 1e6;
  }
  if (targetBoxes != null && loads.size > targetBoxes) {
    return -1.5e8 - (loads.size - targetBoxes) * 1e5;
  }

  let shippingGbp = 0;
  const weights: number[] = [];
  for (const { v, w, vol } of loads.values()) {
    if (v > maxV + 1e-6 || w > maxW + 1e-6) {
      const over =
        (v > maxV ? v - maxV : 0) * 100 + (w > maxW ? w - maxW : 0);
      return -1e9 - over;
    }
    if (v < minBoxV - 1e-6) return -5e8 - (minBoxV - v) * 2000;
    shippingGbp += estimateShippingGbpForTotals(w, vol);
    weights.push(w);
  }

  let boxCountPenalty = 0;
  if (targetBoxes != null && loads.size < targetBoxes) {
    // Prefer using the full requested box count when packing allows.
    boxCountPenalty = (targetBoxes - loads.size) * 8;
  }

  // Maximize fitness == minimize shipping, then prefer even weight / full target.
  return -shippingGbp - weightImbalancePenaltyGbp(weights, maxW) - boxCountPenalty;
}

function emsZone3CarrierRate(chargeableKg: number): number {
  if (chargeableKg <= 0) return 0;
  for (const row of EMS_ZONE3_RATES) {
    if (chargeableKg <= row.upToKg + 1e-9) return row.yen;
  }
  return EMS_ZONE3_RATES[EMS_ZONE3_RATES.length - 1]!.yen;
}

export function shippingChargeableWeightKg(
  sumWeightG: number,
  sumVolumeCm3: number,
): number {
  const actualKg = sumWeightG / 1000;
  const volumetricKg = sumVolumeCm3 / SHIPPING_VOLUMETRIC_DIVISOR_CM3_PER_KG;
  switch (SHIPPING_CALC_METHOD) {
    case "ems":
      return actualKg;
    default:
      return Math.max(actualKg, volumetricKg);
  }
}

export function estimateShippingYenForTotals(
  sumWeightG: number,
  sumVolumeCm3: number,
): number {
  const chargeableKg = shippingChargeableWeightKg(sumWeightG, sumVolumeCm3);
  switch (SHIPPING_CALC_METHOD) {
    case "ems":
      return emsZone3CarrierRate(chargeableKg);
    default:
      return emsZone3CarrierRate(chargeableKg);
  }
}

export function estimateShippingGbpForTotals(
  sumWeightG: number,
  sumVolumeCm3: number,
): number {
  return estimateShippingYenForTotals(sumWeightG, sumVolumeCm3) * JPY_TO_GBP;
}

export function validateItemsForPacking(items: PackageItem[]): string | null {
  const rate = JPY_TO_GBP;
  const maxV = MAX_BOX_VALUE_GBP;
  const maxW = MAX_BOX_WEIGHT_G;
  const bad: string[] = [];
  for (const it of items) {
    const v = valueGbp(it, rate);
    if (v > maxV + 1e-6 || it.weightG > maxW + 1e-6) {
      bad.push(it.packageNumber);
    }
  }
  if (bad.length === 0) return null;
  return `Over single-box limit (£${maxV} / ${maxW} g): ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? "…" : ""}`;
}
