import { useState } from "react";

/**
 * Name login, no password (manual section 4).
 *
 * This is accountability, not security: every ledger row carries the name so
 * you know who to ask during reconciliation. In a lab where everyone already
 * has file access, a password would be theatre.
 */
export function NameGate({ onPick }: { onPick: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="gate">
      <h1>RAID Lab Inventory Ledger</h1>
      <p className="muted">
        Type your name to begin. Every scan you make is recorded against it.
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onPick(name.trim()); }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="your name"
          aria-label="your name"
        />
        <button type="submit" disabled={!name.trim()}>Start</button>
      </form>
    </div>
  );
}
