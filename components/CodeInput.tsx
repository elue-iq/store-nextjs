"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { toLatinDigits } from "@/lib/phone";

// One square per digit. Numbers only (Arabic digits are accepted and converted),
// moves to the next square while typing, Backspace goes back, and pasting or
// WhatsApp/SMS autofill of the whole code fills every square.
// Calls onComplete as soon as all squares are filled.

export type CodeInputHandle = { clear: () => void; focus: () => void };

type Props = {
  length: number;
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
};

export const CodeInput = forwardRef<CodeInputHandle, Props>(function CodeInput(
  { length, value, onChange, onComplete, disabled, invalid, describedBy },
  ref,
) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  useImperativeHandle(ref, () => ({
    clear: () => {
      onChange("");
      boxes.current[0]?.focus();
    },
    focus: () => boxes.current[Math.min(value.length, length - 1)]?.focus(),
  }));

  function setFrom(index: number, typed: string) {
    const clean = toLatinDigits(typed).replace(/\D/g, "");
    if (!clean) return;
    const start = Math.min(index, value.length);
    const next = (value.slice(0, start) + clean + value.slice(start + clean.length)).slice(0, length);
    onChange(next);
    const focusAt = Math.min(start + clean.length, length - 1);
    boxes.current[focusAt]?.focus();
    if (next.length === length) onComplete(next);
  }

  return (
    <div className="code-boxes" dir="ltr" role="group" aria-label={`رمز التحقق، ${length} أرقام`}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          className="code-box"
          value={d}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={i === 0 ? length : 1}
          aria-label={`الرقم ${i + 1}`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          autoFocus={i === 0}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const typed = e.currentTarget.value;
            if (!typed) {
              onChange(value.slice(0, i));
              return;
            }
            // Keep only what was newly typed into this square.
            setFrom(i, d && typed.length > 1 && typed.startsWith(d) ? typed.slice(1) : typed);
          }}
          onPaste={(e) => {
            e.preventDefault();
            setFrom(0, e.clipboardData.getData("text"));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d && i > 0) {
              e.preventDefault();
              onChange(value.slice(0, i - 1));
              boxes.current[i - 1]?.focus();
            } else if (e.key === "ArrowLeft" && i > 0) {
              boxes.current[i - 1]?.focus();
            } else if (e.key === "ArrowRight" && i < length - 1) {
              boxes.current[i + 1]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
});
