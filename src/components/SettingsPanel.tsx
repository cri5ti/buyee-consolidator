import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../config";

const FIELDS: { key: keyof Settings; label: string; step: string }[] = [
  { key: "maxBoxValueGbp", label: "Max box value (£)", step: "1" },
  { key: "minBoxValueGbp", label: "Min box value (£)", step: "1" },
  { key: "maxBoxWeightG", label: "Max box weight (g)", step: "100" },
  { key: "jpyToGbp", label: "JPY → GBP rate", step: "0.000001" },
];

export function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  // Draft strings so partially typed numbers ("0.") don't get clobbered.
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => setDraft({}), [settings]);

  return (
    <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      {FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1 text-xs text-zinc-600">
          {f.label}
          <input
            type="number"
            min={0}
            step={f.step}
            value={draft[f.key] ?? String(settings[f.key])}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft((d) => ({ ...d, [f.key]: raw }));
              const v = Number(raw);
              if (raw !== "" && Number.isFinite(v) && v >= 0)
                onChange({ ...settings, [f.key]: v });
            }}
            className="w-36 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm tabular-nums shadow-sm"
          />
        </label>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_SETTINGS })}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
      >
        Reset defaults
      </button>
    </div>
  );
}
