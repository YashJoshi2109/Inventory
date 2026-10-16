import { useCallback, useEffect, useState } from "react";
import { bootApp, type BootedApp } from "./boot.ts";
import { NameGate } from "./components/NameGate.tsx";
import { ScanPanel } from "./components/ScanPanel.tsx";
import { StatusTable } from "./components/StatusTable.tsx";
import { ItemsPanel } from "./components/ItemsPanel.tsx";
import { LogPanel } from "./components/LogPanel.tsx";
import { HealthPanel } from "./components/HealthPanel.tsx";
import type { EventRow, ItemRow, StatusView, StoreMeta } from "../service/types.ts";

type Tab = "scan" | "status" | "items" | "log" | "health";

export function App() {
  const [booted, setBooted] = useState<BootedApp | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [user, setUser] = useState("");
  const [tab, setTab] = useState<Tab>("scan");

  const [status, setStatus] = useState<StatusView | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [storeMeta, setStoreMeta] = useState<StoreMeta | null>(null);

  useEffect(() => {
    bootApp().then(setBooted).catch((e) =>
      setBootError(e instanceof Error ? e.message : String(e)));
  }, []);

  const refresh = useCallback(async () => {
    if (!booted) return;
    const [s, i, e, m] = await Promise.all([
      booted.service.getStatus(),
      booted.service.getItems(),
      booted.service.getEvents(),
      booted.service.meta(),
    ]);
    setStatus(s); setItems(i); setEvents(e); setStoreMeta(m);
  }, [booted]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (bootError) {
    return <div className="gate"><h1>Could not start</h1><p className="error">{bootError}</p></div>;
  }
  if (!booted) return <div className="gate"><p>Starting…</p></div>;

  if (!user) {
    return (
      <NameGate onPick={(name) => { booted.service.setUser(name); setUser(name); }} />
    );
  }

  const conflictCount = status?.conflicts.length ?? 0;
  const unknownCount = status?.unknownScans.length ?? 0;

  return (
    <div className="app">
      {booted.hostMeta?.demoMode && (
        <p className="demo-banner" role="status">
          DEMO MODE — everything you do here is written to <code>data-demo/</code>.
          The real ledgers are untouched. Close and reopen without{" "}
          <code>--demo</code> for the real thing.
        </p>
      )}
      <header>
        <div>
          <strong>RAID Lab Inventory Ledger</strong>
          <span className="muted"> — {booted.degraded ? "offline, no host" : "offline, host connected"}</span>
        </div>
        <div className="who">
          {user} · <span className="mono">{storeMeta?.deviceId}</span>
        </div>
      </header>

      <nav>
        {(["scan", "status", "items", "log", "health"] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? "tab active" : "tab"}
            onClick={() => setTab(t)}
            // The badge is decorative duplication of what the Health tab lists.
            // Excluding it from the accessible name keeps that name stable as
            // "health" rather than "health 2", which a screen reader would read
            // as a meaningless number anyway.
            aria-label={t}
          >
            {t}
            {t === "health" && (conflictCount + unknownCount > 0) && (
              <span
                className="badge"
                aria-hidden="true"
                title={`${conflictCount} conflict(s), ${unknownCount} unknown scan(s)`}
              >
                {conflictCount + unknownCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main>
        {tab === "scan" && <ScanPanel service={booted.service} onChanged={refresh} />}
        {tab === "status" && <StatusTable status={status} />}
        {tab === "items" && (
          <ItemsPanel service={booted.service} items={items} onChanged={refresh} />
        )}
        {tab === "log" && <LogPanel events={events} />}
        {tab === "health" && (
          <HealthPanel
            status={status}
            hostMeta={booted.hostMeta}
            storeMeta={storeMeta}
            report={booted.report}
            degraded={booted.degraded}
          />
        )}
      </main>
    </div>
  );
}
