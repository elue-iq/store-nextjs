"use client";

// «فقط | بدون»: turns a filter from «only these» into «everything except these».
// Shown next to a filter once something is chosen in it.
export function NotToggle({ on, onChange, what }: { on: boolean; onChange: (on: boolean) => void; what: string }) {
  return (
    <span className="not-toggle" role="group" aria-label={`طريقة فلترة ${what}`}>
      <button type="button" aria-pressed={!on} onClick={() => onChange(false)} title={`فقط ${what} المختار`}>
        فقط
      </button>
      <button type="button" aria-pressed={on} onClick={() => onChange(true)} title={`كل الطلبات عدا ${what} المختار`}>
        بدون
      </button>
    </span>
  );
}
