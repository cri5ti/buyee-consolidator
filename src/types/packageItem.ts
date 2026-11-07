export type DimensionsCm = { l: number; w: number; h: number };

export type PackageItem = {
  id: string;
  packageNumber: string;
  itemTitle: string;
  originalValueYen: number;
  weightG: number;
  dimensionsCm: DimensionsCm;
  freeStorageDaysLeft: number | null;
  /** Free storage ended: freeStorageDaysLeft is then "days until disposal". */
  storageExpired?: boolean;
  /** All line items in the package (title + Buyee item page). */
  lineItems?: { title: string; url: string }[];
  /** Link to the first line item on Buyee (opened as a quick preview). */
  itemUrl?: string | null;
  /** No longer listed on Buyee (e.g. already consolidated). Kept for history. */
  gone?: boolean;
};

export function valueGbp(item: PackageItem, rate: number): number {
  return item.originalValueYen * rate;
}

export function volumeCm3(item: PackageItem): number {
  const { l, w, h } = item.dimensionsCm;
  return l * w * h;
}
