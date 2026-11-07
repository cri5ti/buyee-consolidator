export type Settings = {
  /** Multiply JPY by this to get GBP. */
  jpyToGbp: number;
  /** Max declared value per box (£). */
  maxBoxValueGbp: number;
  /** Auto-assign drops boxes with total declared value below this (£). */
  minBoxValueGbp: number;
  /** Max weight per box (g). */
  maxBoxWeightG: number;
};

export const DEFAULT_SETTINGS: Settings = {
  jpyToGbp: 0.004794020131, // https://www.trade-tariff.service.gov.uk/exchange_rates/view/2026-10?type=monthly
  maxBoxValueGbp: 135,
  minBoxValueGbp: 40,
  maxBoxWeightG: 6000,
};

/**
 * Live bindings: other modules import these names and always see the current
 * value. They are changed only through applySettings() (user settings are
 * persisted by storage.ts and applied at startup / when edited in the UI).
 */
export let JPY_TO_GBP = DEFAULT_SETTINGS.jpyToGbp;
export let MAX_BOX_VALUE_GBP = DEFAULT_SETTINGS.maxBoxValueGbp;
export let MIN_BOX_VALUE_GBP = DEFAULT_SETTINGS.minBoxValueGbp;
export let MAX_BOX_WEIGHT_G = DEFAULT_SETTINGS.maxBoxWeightG;

export function applySettings(s: Settings): void {
  JPY_TO_GBP = s.jpyToGbp;
  MAX_BOX_VALUE_GBP = s.maxBoxValueGbp;
  MIN_BOX_VALUE_GBP = s.minBoxValueGbp;
  MAX_BOX_WEIGHT_G = s.maxBoxWeightG;
}

export type ShippingCalcMethod = "ems";

/** Select which shipping calculator to use in UI totals. */
export const SHIPPING_CALC_METHOD: ShippingCalcMethod = "ems";

/** Volumetric divisor used by calculators that support dimensional weight. */
export const SHIPPING_VOLUMETRIC_DIVISOR_CM3_PER_KG = 5000;

/** Japan Post EMS Zone 3 rate schedule (JPY). */
export const EMS_ZONE3_RATES: Array<{ upToKg: number; yen: number }> = [
  { upToKg: 0.5, yen: 3150 },
  { upToKg: 0.6, yen: 3400 },
  { upToKg: 0.7, yen: 3650 },
  { upToKg: 0.8, yen: 3900 },
  { upToKg: 0.9, yen: 4150 },
  { upToKg: 1.0, yen: 4400 },
  { upToKg: 1.25, yen: 5000 },
  { upToKg: 1.5, yen: 5550 },
  { upToKg: 1.75, yen: 6150 },
  { upToKg: 2.0, yen: 6700 },
  { upToKg: 2.5, yen: 7750 },
  { upToKg: 3.0, yen: 8800 },
  { upToKg: 3.5, yen: 9850 },
  { upToKg: 4.0, yen: 10900 },
  { upToKg: 4.5, yen: 11950 },
  { upToKg: 5.0, yen: 13000 },
  { upToKg: 5.5, yen: 14050 },
  { upToKg: 6.0, yen: 15100 },
  { upToKg: 7.0, yen: 17200 },
  { upToKg: 8.0, yen: 19300 },
  { upToKg: 9.0, yen: 21400 },
  { upToKg: 10.0, yen: 23500 },
  { upToKg: 11.0, yen: 25600 },
  { upToKg: 12.0, yen: 27700 },
  { upToKg: 13.0, yen: 29800 },
  { upToKg: 14.0, yen: 31900 },
  { upToKg: 15.0, yen: 34000 },
  { upToKg: 16.0, yen: 36100 },
  { upToKg: 17.0, yen: 38200 },
  { upToKg: 18.0, yen: 40300 },
  { upToKg: 19.0, yen: 42400 },
  { upToKg: 20.0, yen: 44500 },
  { upToKg: 21.0, yen: 46600 },
  { upToKg: 22.0, yen: 48700 },
  { upToKg: 23.0, yen: 50800 },
  { upToKg: 24.0, yen: 52900 },
  { upToKg: 25.0, yen: 55000 },
  { upToKg: 26.0, yen: 57100 },
  { upToKg: 27.0, yen: 59200 },
  { upToKg: 28.0, yen: 61300 },
  { upToKg: 29.0, yen: 63400 },
  { upToKg: 30.0, yen: 65500 },
];
