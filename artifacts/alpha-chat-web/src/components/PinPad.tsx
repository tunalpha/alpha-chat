/**
 * PinPad — Sprint 17
 * Tastierino numerico per inserimento PIN a 6 cifre.
 */

import { useState, useEffect, useCallback } from "react";

interface Props {
  length?: number;
  onComplete: (pin: string) => void;
  disabled?: boolean;
  error?: string | null;
  label?: string;
}

const DIGITS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

export default function PinPad({
  length = 6,
  onComplete,
  disabled = false,
  error,
  label = "Inserisci il PIN",
}: Props) {
  const [value, setValue] = useState("");

  // Reset on error
  useEffect(() => {
    if (error) {
      setTimeout(() => setValue(""), 500);
    }
  }, [error]);

  const press = useCallback(
    (d: string) => {
      if (disabled) return;
      if (d === "⌫") {
        setValue((v) => v.slice(0, -1));
        return;
      }
      if (d === "") return;
      setValue((v) => {
        const next = v + d;
        if (next.length === length) {
          setTimeout(() => onComplete(next), 80);
        }
        return next.length <= length ? next : v;
      });
    },
    [disabled, length, onComplete]
  );

  // Tastiera fisica
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") press(e.key);
      if (e.key === "Backspace") press("⌫");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [press]);

  return (
    <div className="pinpad-root">
      <div className="pinpad-label">{label}</div>

      {/* Dots */}
      <div className="pinpad-dots" aria-label={`PIN: ${value.length} di ${length} cifre`}>
        {Array.from({ length }).map((_, i) => (
          <div
            key={i}
            className={`pinpad-dot${i < value.length ? " filled" : ""}${error ? " error" : ""}`}
          />
        ))}
      </div>

      {error && <div className="pinpad-error">{error}</div>}

      {/* Grid */}
      <div className="pinpad-grid">
        {DIGITS.map((d, i) => (
          <button
            key={i}
            className={`pinpad-key${d === "" ? " invisible" : ""}${d === "⌫" ? " delete" : ""}`}
            onClick={() => press(d)}
            disabled={disabled || d === ""}
            aria-label={d === "⌫" ? "Cancella" : d === "" ? "" : d}
            tabIndex={d === "" ? -1 : 0}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}
