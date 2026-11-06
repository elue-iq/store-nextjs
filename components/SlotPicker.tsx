"use client";

import { useMemo } from "react";
import { DELIVERY_SLOTS, dateLabel, slotDateOptions, type SlotKey } from "@/lib/delivery-slot";
import { site } from "@/lib/site";

// Baghdad only: the day and the evening period the customer wants. We cannot promise
// an exact time, so it is a period; it is printed on the courier label.
export function SlotPicker({
  slot,
  date,
  onSlot,
  onDate,
  id,
}: {
  slot: SlotKey;
  date: string;
  onSlot: (k: SlotKey) => void;
  onDate: (d: string) => void;
  id?: string;
}) {
  const days = useMemo(() => {
    const list = slotDateOptions();
    // An existing order may already have a day that is no longer in the list.
    return date && !list.some((d) => d.value === date) ? [...list, { value: date, label: dateLabel(date) }] : list;
  }, [date]);
  return (
    <fieldset className="slot-picker" id={id}>
      <legend>موعد التوصيل في بغداد</legend>
      <p className="field-note">{site.baghdadWindow.note}</p>
      <label className="slot-picker__day">
        <span>اليوم</span>
        <select value={date} onChange={(e) => onDate(e.target.value)}>
          {days.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <div className="slot-picker__slots" role="radiogroup" aria-label="فترة التوصيل">
        {DELIVERY_SLOTS.map((s) => (
          <label key={s.key} className={slot === s.key ? "slot-picker__slot is-on" : "slot-picker__slot"}>
            <input type="radio" name={`slot-${id ?? "x"}`} checked={slot === s.key} onChange={() => onSlot(s.key)} />
            <span>
              <strong>{s.label}</strong>
              <small>{s.range}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
