import type { PackageItem } from "./types/packageItem";

export type MergeResult = {
  items: PackageItem[];
  added: number;
  gone: number;
  revived: number;
};

/**
 * Merge a fresh scan into the stored list. Assignments live elsewhere keyed by
 * id, so they are untouched: existing items keep their box, new items are
 * simply unassigned, and items missing from the scan are flagged `gone`.
 */
export function mergeScan(
  existing: PackageItem[],
  scanned: PackageItem[],
): MergeResult {
  const scannedById = new Map(scanned.map((i) => [i.id, i]));
  const existingIds = new Set(existing.map((i) => i.id));
  let gone = 0;
  let revived = 0;

  const items: PackageItem[] = existing.map((old) => {
    const fresh = scannedById.get(old.id);
    if (fresh) {
      if (old.gone) revived++;
      return { ...fresh, gone: false };
    }
    if (!old.gone) gone++;
    return { ...old, gone: true };
  });

  let added = 0;
  for (const s of scanned) {
    if (!existingIds.has(s.id)) {
      items.push({ ...s, gone: false });
      added++;
    }
  }
  return { items, added, gone, revived };
}
