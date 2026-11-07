import type { PackageItem } from "../types/packageItem";
import { valueGbp } from "../types/packageItem";
import {
  JPY_TO_GBP,
  MAX_BOX_VALUE_GBP,
  MAX_BOX_WEIGHT_G,
  MIN_BOX_VALUE_GBP,
} from "../config";
import {
  fitnessFromAssignments,
  MAX_TARGET_BOXES,
  suggestedBoxCount,
  validateItemsForPacking,
} from "./packingUtils";

const UI_TICK_MS = 1000;
/** Inner trials per generation: random remove-5 + greedy each. */
const TRIALS_PER_GENERATION = 16;

function randomInt(n: number): number {
  return Math.floor(Math.random() * n);
}

function shuffleCopy<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function canonicalizeAssignments(
  raw: Record<string, number>,
): Record<string, number> {
  const used = [...new Set(Object.values(raw))].sort((a, b) => a - b);
  const map = new Map(used.map((old, i) => [old, i + 1]));
  const out: Record<string, number> = {};
  for (const id of Object.keys(raw)) {
    out[id] = map.get(raw[id]!)!;
  }
  return out;
}

/**
 * Pack unassigned items into at most `targetBoxes` slots: prefer the lightest
 * feasible box (item-count tiebreak so empty boxes fill evenly); £ slack last.
 * Items that cannot fit stay unassigned.
 * `partial` maps item id -> box label (any positive int); missing = unassigned.
 */
export function greedyPackFromPartial(
  items: PackageItem[],
  partial: Record<string, number>,
  rate: number,
  maxV: number,
  maxW: number,
  _minBoxV: number,
  targetBoxes: number,
): Record<string, number> {
  const n = Math.max(
    1,
    Math.min(MAX_TARGET_BOXES, Math.floor(targetBoxes), items.length),
  );
  const loads = new Map<number, { v: number; w: number; count: number }>();
  const placed = new Map<string, number>();

  for (const it of items) {
    const b = partial[it.id];
    if (b != null && b >= 1 && b <= n) {
      placed.set(it.id, b);
      const L = loads.get(b) ?? { v: 0, w: 0, count: 0 };
      L.v += valueGbp(it, rate);
      L.w += it.weightG;
      L.count += 1;
      loads.set(b, L);
    }
  }

  for (let i = 1; i <= n; i++) {
    if (!loads.has(i)) loads.set(i, { v: 0, w: 0, count: 0 });
  }

  const unassigned = items.filter((it) => !placed.has(it.id));
  const order = shuffleCopy(unassigned);

  for (const it of order) {
    const g = valueGbp(it, rate);
    const wg = it.weightG;
    let pick = -1;
    let bestResultW = Infinity;
    let bestCount = Infinity;
    let bestVs = Infinity;
    for (const [bid, L] of loads) {
      if (L.v + g <= maxV && L.w + wg <= maxW) {
        const resultW = L.w + wg;
        const vs = maxV - (L.v + g);
        if (
          resultW < bestResultW - 1e-12 ||
          (Math.abs(resultW - bestResultW) < 1e-12 && L.count < bestCount) ||
          (Math.abs(resultW - bestResultW) < 1e-12 &&
            L.count === bestCount &&
            vs < bestVs - 1e-12)
        ) {
          bestResultW = resultW;
          bestCount = L.count;
          bestVs = vs;
          pick = bid;
        }
      }
    }
    if (pick >= 0) {
      const L = loads.get(pick)!;
      L.v += g;
      L.w += wg;
      L.count += 1;
      placed.set(it.id, pick);
    }
  }

  const raw: Record<string, number> = {};
  for (const it of items) {
    const b = placed.get(it.id);
    if (b != null) raw[it.id] = b;
  }
  return canonicalizeAssignments(raw);
}

function perturbRemoveUpToFive(
  best: Record<string, number>,
): Record<string, number> {
  const ids = Object.keys(best);
  if (ids.length === 0) return {};
  const k = Math.min(ids.length, 1 + randomInt(Math.min(5, ids.length)));
  const out = { ...best };
  const drop = shuffleCopy(ids).slice(0, k);
  for (const id of drop) delete out[id];
  return out;
}

function isBetter(a: number, b: number): boolean {
  return a > b + 1e-9;
}

export type OptimizeState = {
  generation: number;
  bestScore: number;
  assignments: Record<string, number>;
  boxesUsed: number;
  assignedCount: number;
  /** User-selected consolidation box count. */
  targetBoxes: number;
};

function stateFromAssignments(
  assignments: Record<string, number>,
  items: PackageItem[],
  generation: number,
  rate: number,
  maxV: number,
  maxW: number,
  minBoxV: number,
  targetBoxes: number,
): OptimizeState {
  const bestScore = fitnessFromAssignments(
    assignments,
    items,
    rate,
    maxV,
    maxW,
    minBoxV,
    targetBoxes,
  );
  return {
    generation,
    bestScore,
    assignments,
    boxesUsed: new Set(Object.values(assignments)).size,
    assignedCount: Object.keys(assignments).length,
    targetBoxes,
  };
}

/**
 * Greedy init (random order), then each ~1s generation: several trials that
 * remove up to 5 random assignments and re-greedy into `targetBoxes` slots.
 */
export function runGreedyOptimize(
  items: PackageItem[],
  onProgress: (s: OptimizeState) => void,
  signal: AbortSignal,
  targetBoxes: number = suggestedBoxCount(items),
): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    if (items.length === 0) {
      finish();
      return;
    }

    if (validateItemsForPacking(items)) {
      finish();
      return;
    }

    const rate = JPY_TO_GBP;
    const maxV = MAX_BOX_VALUE_GBP;
    const maxW = MAX_BOX_WEIGHT_G;
    const minBoxV = MIN_BOX_VALUE_GBP;
    const n = Math.max(
      1,
      Math.min(MAX_TARGET_BOXES, Math.floor(targetBoxes), items.length),
    );

    let best = greedyPackFromPartial(items, {}, rate, maxV, maxW, minBoxV, n);
    let bestScore = fitnessFromAssignments(
      best,
      items,
      rate,
      maxV,
      maxW,
      minBoxV,
      n,
    );
    let generation = 0;

    onProgress(
      stateFromAssignments(
        best,
        items,
        generation,
        rate,
        maxV,
        maxW,
        minBoxV,
        n,
      ),
    );

    const tick = () => {
      if (signal.aborted) {
        finish();
        return;
      }

      for (let t = 0; t < TRIALS_PER_GENERATION; t++) {
        const partial = perturbRemoveUpToFive(best);
        const cand = greedyPackFromPartial(
          items,
          partial,
          rate,
          maxV,
          maxW,
          minBoxV,
          n,
        );
        const sc = fitnessFromAssignments(
          cand,
          items,
          rate,
          maxV,
          maxW,
          minBoxV,
          n,
        );
        if (isBetter(sc, bestScore)) {
          best = cand;
          bestScore = sc;
        }
      }

      generation++;

      onProgress(
        stateFromAssignments(
          best,
          items,
          generation,
          rate,
          maxV,
          maxW,
          minBoxV,
          n,
        ),
      );

      setTimeout(tick, UI_TICK_MS);
    };

    setTimeout(tick, UI_TICK_MS);
  });
}
