import { useEffect, useRef, useState } from "react";
import type { LedgerService } from "../../service/ledgerService.ts";
import type { ScanOutcome } from "../../service/types.ts";

/**
 * The scan surface.
 *
 * A USB keyboard-wedge scanner types into a focused field and presses Enter --
 * zero drivers, works offline, and it is the primary input path per
 * TEAM_INSTRUCTIONS_INVENTORY section 2. So the box keeps itself focused.
 *
 * This component classifies nothing and decides nothing: it hands the raw
 * string to LedgerService and renders what comes back.
 */
export function ScanPanel({
  service, onChanged,
}: { service: LedgerService; onChanged: () => void }) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"auto" | "checkout" | "return">("auto");
  const [last, setLast] = useState<ScanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<{ label: string; msRemaining: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the wedge target focused. A scanner that types into nothing is a
  // scan silently lost.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const t = setInterval(focus, 1500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const a = service.getArmed();
      setArmed(a ? { label: a.label, msRemaining: a.msRemaining } : null);
    }, 250);
    return () => clearInterval(t);
  }, [service]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    setValue("");
    setError(null);
    try {
      const outcome = await service.scan(raw, { mode });
      setLast(outcome);
      if (mode !== "auto") setMode("auto");   // one-shot, like the baseline
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmPlace(eventId: string, location: string) {
    await service.confirm(eventId, { location, command: "place" });
    setLast(null);
    onChanged();
  }

  return (
    <div className="panel">
      <form onSubmit={submit} className="scanbar">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="scan or type a barcode, EPC, or shelf label"
          aria-label="scan input"
          autoComplete="off"
        />
        <button type="submit">Log</button>
      </form>

      <div className="modes">
        {(["auto", "checkout", "return"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? "mode active" : "mode"}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {armed ? (
        <p className="armed">
          Armed: <strong>{armed.label}</strong> — next item scan is placed here
          ({Math.ceil(armed.msRemaining / 1000)}s)
        </p>
      ) : (
        <p className="muted">
          No shelf armed. Scan a shelf label first to place items.
        </p>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {last?.result === "armed" && (
        <p className="ok">Armed {last.locationLabel}.</p>
      )}

      {last?.result === "logged" && (
        <div className="outcome">
          <p>
            Logged <span className="mono">{last.event.event_id}</span> —{" "}
            <strong>{last.applied}</strong>
            {last.item
              ? <> — {last.item.description || last.item.item_id}</>
              : <> — <span className="warn">no matching item</span></>}
          </p>
          {last.needsConfirmation && last.confirmationPrompt && (
            <div className="confirm">
              <p>{last.confirmationPrompt}</p>
              <div className="confirm-actions">
                {Object.entries(service.config.locations).map(([code, label]) => (
                  <button key={code} type="button"
                          onClick={() => confirmPlace(last.event.event_id, code)}>
                    {label}
                  </button>
                ))}
                <button type="button" className="ghost" onClick={() => setLast(null)}>
                  Ignore
                </button>
              </div>
              <p className="muted small">
                Ignoring is fine. The scan is already recorded and simply stays
                flagged unconfirmed.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
