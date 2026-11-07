import { useCallback, useRef, useState } from "react";

type Props = {
  onLoadHtml: (html: string) => void;
  disabled?: boolean;
};

export function ImportDropzone({ onLoadHtml, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const readFile = useCallback(
    (file: File) => {
      if (!file.type.includes("html") && !file.name.match(/\.html?$/i)) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        onLoadHtml(text);
      };
      reader.readAsText(file);
    },
    [onLoadHtml],
  );

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) readFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  };

  return (
    <div
      className={`rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
        dragOver
          ? "border-sky-500 bg-sky-50"
          : "border-zinc-300 bg-zinc-50 hover:border-zinc-400"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <p className="text-sm text-zinc-700">
        Drop a Buyee HTML export here, or{" "}
        <button
          type="button"
          className="font-medium text-sky-700 underline decoration-sky-600/40 hover:decoration-sky-700"
          onClick={() => inputRef.current?.click()}
        >
          choose file
        </button>
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm,text/html"
        className="sr-only"
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}
