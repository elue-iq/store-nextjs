"use client";

// The order list's filter bar (/admin), built like a shop app's:
// - status tabs in one line (the filter used all day);
// - one «فلترة» button that opens a sheet with every other filter, each choice with its count;
// - the active filters as small chips under the bar, each removable with one tap.
// «فقط | بدون» lives inside the sheet, next to the filter it changes.

import { useEffect, useMemo, useState } from "react";
import { NotToggle } from "./NotToggle";
import {
  activeFacets,
  chipText,
  clearFacet,
  EMPTY_FILTERS,
  FACET_TITLES,
  FACETS,
  toggleChoice,
  type Choice,
  type FacetKey,
  type OrderFilters,
  type Sort,
} from "./orderFilters";

type Props = {
  f: OrderFilters;
  onChange: (f: OrderFilters) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  choices: Record<FacetKey, Choice[]>;
  total: number; // orders after the search, before any filter
  shown: number; // orders after the filters
};

const X = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export function AdminOrderFilters({ f, onChange, sort, onSort, choices, total, shown }: Props) {
  const [open, setOpen] = useState(false);
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of FACETS) for (const c of choices[k]) m.set(`${k}:${c.value}`, c.label);
    return m;
  }, [choices]);
  const active = activeFacets(f);
  // A status chosen with one tab is already visible on the tabs; a chip only for the other cases.
  const chips = active.filter((k) => k !== "status" || f.status.length > 1 || f.not.status);
  const statusTab = f.status.length === 1 && !f.not.status ? f.status[0] : f.status.length ? null : "ALL";

  return (
    <div className="ofilters" data-no-pending>
      <div className="ofilters__tabs" role="tablist" aria-label="حالة الطلب">
        <button type="button" role="tab" aria-selected={statusTab === "ALL"} onClick={() => onChange(clearFacet(f, "status"))}>
          الكل <span>{choices.status.reduce((n, c) => n + c.count, 0)}</span>
        </button>
        {choices.status.map((c) => (
          <button
            key={c.value}
            type="button"
            role="tab"
            aria-selected={statusTab === c.value}
            onClick={() => onChange({ ...f, status: [c.value as OrderFilters["status"][number]], not: { ...f.not, status: false } })}
          >
            {c.label} <span>{c.count}</span>
          </button>
        ))}
      </div>

      <div className="ofilters__bar">
        <button type="button" className={`ofilters__open${active.length ? " is-on" : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
          </svg>
          فلترة
          {active.length > 0 && <span className="ofilters__badge">{active.length}</span>}
        </button>
        <label className="ofilters__sort">
          <span className="visually-hidden">الترتيب</span>
          <select value={sort} onChange={(e) => onSort(e.target.value as Sort)}>
            <option value="newest">الأحدث</option>
            <option value="oldest">الأقدم</option>
          </select>
        </label>
      </div>
      {chips.length > 0 && (
        <div className="ofilters__chips">
          {chips.map((k) => (
            <button
              key={k}
              type="button"
              className={`ofilters__chip${f.not[k] ? " is-not" : ""}`}
              onClick={() => onChange(clearFacet(f, k))}
              aria-label={`إزالة فلتر ${FACET_TITLES[k]}`}
            >
              <span>{chipText(k, f, labels)}</span>
              {X}
            </button>
          ))}
        </div>
      )}

      {open && <FilterSheet f={f} onChange={onChange} choices={choices} total={total} shown={shown} onClose={() => setOpen(false)} />}
    </div>
  );
}

function FilterSheet({
  f,
  onChange,
  choices,
  total,
  shown,
  onClose,
}: Pick<Props, "f" | "onChange" | "choices" | "total" | "shown"> & { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="osheet" data-no-pending role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="osheet__panel" role="dialog" aria-modal="true" aria-labelledby="osheet-title">
        <header className="osheet__head">
          <h2 id="osheet-title">فلترة الطلبات</h2>
          <button type="button" className="osheet__x" onClick={onClose} aria-label="إغلاق">
            {X}
          </button>
        </header>
        <div className="osheet__body">
          {FACETS.map((k) => {
            const list = choices[k].filter((c) => c.count > 0 || (f[k] as string[]).includes(c.value));
            if (!list.length) return null;
            const picked = f[k].length > 0;
            return (
              <section key={k} className="osheet__group">
                <div className="osheet__title">
                  <h3>{FACET_TITLES[k]}</h3>
                  {picked && <NotToggle on={Boolean(f.not[k])} onChange={(on) => onChange({ ...f, not: { ...f.not, [k]: on } })} what={FACET_TITLES[k]} />}
                  {picked && (
                    <button type="button" className="link-button" onClick={() => onChange(clearFacet(f, k))}>
                      مسح
                    </button>
                  )}
                </div>
                <div className={`osheet__choices${f.not[k] ? " is-not" : ""}`}>
                  {list.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={(f[k] as string[]).includes(c.value)}
                      onClick={() => onChange(toggleChoice(f, k, c.value))}
                    >
                      {c.label}
                      <span>{c.count}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <footer className="osheet__foot">
          <button type="button" className="btn btn--quiet" onClick={() => onChange(EMPTY_FILTERS)} disabled={!activeFacets(f).length}>
            مسح الكل
          </button>
          <button type="button" className="btn" onClick={onClose}>
            عرض {shown === total ? "كل الطلبات" : `${shown} طلب`}
          </button>
        </footer>
      </div>
    </div>
  );
}
