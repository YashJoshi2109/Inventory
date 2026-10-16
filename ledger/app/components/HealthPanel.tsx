import { netGuardState } from "../../bridge/netGuard.ts";
import type { BootstrapReport, StatusView } from "../../service/types.ts";
import type { HostMeta } from "../../service/types.ts";
import type { StoreMeta } from "../../service/types.ts";

/**
 * Honesty panel.
 *
 * The manual forbids the UI from ever looking healthier than it is: undisclosed
 * simulated data is prohibited, and a missing source has to say so. So this
 * shows the unflattering numbers -- unknown scans, conflicts, non-contract event
 * types, and the count of network requests that escaped the local host.
 *
 * netGuard is diagnostics, not domain, which is why it is the one non-service
 * import allowed in a component.
 */
export function HealthPanel({
  status, hostMeta, storeMeta, report, degraded,
}: {
  status: StatusView | null;
  hostMeta: HostMeta | null;
  storeMeta: StoreMeta | null;
  report: BootstrapReport | null;
  degraded: boolean;
}) {
  const net = netGuardState();

  return (
    <div className="panel">
      <h3>Offline guarantee</h3>
      <p className={net.externalCount === 0 ? "ok" : "error"}>
        External network requests since launch: <strong>{net.externalCount}</strong>
        {net.externalCount === 0
          ? " — nothing has left this machine."
          : " — the offline promise is broken; see the list below."}
      </p>
      <p className="muted small">Local requests (to this host): {net.localCount}</p>
      {net.externalCount > 0 && (
        <ul className="small">
          {net.records.filter((r) => r.external).map((r, i) => (
            <li key={i} className="mono">{r.method} {r.url}</li>
          ))}
        </ul>
      )}

      <h3>Storage</h3>
      {degraded ? (
        <p className="warn">
          No local host detected. Running on IndexedDB only — nothing is being
          mirrored to CSV, so a browser data wipe would lose this data.
          Launch via the exe to get CSV files on disk.
        </p>
      ) : (
        <p className="ok">
          Host connected. Ledgers mirrored to <span className="mono">{hostMeta?.dataDir}</span>
        </p>
      )}
      <dl className="kv">
        <dt>device id</dt><dd className="mono">{storeMeta?.deviceId ?? "—"}</dd>
        <dt>program version</dt><dd className="mono">{storeMeta?.programVersion ?? "—"}</dd>
        <dt>schema version</dt><dd className="mono">{storeMeta?.schemaVersion ?? "—"}</dd>
        <dt>status algorithm</dt><dd className="mono">{storeMeta?.statusAlgorithmVersion ?? "—"}</dd>
        <dt>item rows</dt><dd>{storeMeta?.itemRowCount ?? 0}</dd>
        <dt>event rows</dt><dd>{storeMeta?.eventRowCount ?? 0}</dd>
      </dl>

      <h3>Last bootstrap</h3>
      {report ? (
        <dl className="kv">
          <dt>imported from disk</dt>
          <dd>{report.importedFromDisk.items} items, {report.importedFromDisk.events} events</dd>
          <dt>written to disk</dt>
          <dd>{report.writtenToDisk.items} items, {report.writtenToDisk.events} events</dd>
          <dt>duplicates skipped</dt><dd>{report.duplicatesSkipped}</dd>
          <dt>id collisions</dt>
          <dd className={report.collisions.length ? "error" : ""}>
            {report.collisions.length === 0 ? "none" : report.collisions.join(", ")}
          </dd>
        </dl>
      ) : <p className="muted">—</p>}

      <h3>Unknown scans</h3>
      <p className="muted small">
        Scans that matched no item. They are recorded, never discarded.
      </p>
      {status && status.unknownScans.length > 0 ? (
        <table>
          <thead><tr><th>event_id</th><th>value</th><th>time</th><th>by</th></tr></thead>
          <tbody>
            {status.unknownScans.map((r) => (
              <tr key={r.event_id}>
                <td className="mono">{r.event_id}</td>
                <td className="mono">{r.value}</td>
                <td className="mono">{r.datetime_utc}</td>
                <td>{r.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="ok">None.</p>}

      <h3>Rows with unreadable timestamps</h3>
      <p className="muted small">
        Kept out of status: a row whose time cannot be read could land anywhere in
        history. Fix the row in the CSV, or have an admin void it.
      </p>
      {status && status.malformedRows.length > 0 ? (
        <table>
          <thead><tr><th>event_id</th><th>value</th><th>datetime_utc</th><th>by</th></tr></thead>
          <tbody>
            {status.malformedRows.map((r) => (
              <tr key={r.event_id}>
                <td className="mono">{r.event_id}</td>
                <td className="mono">{r.value}</td>
                <td className="mono">{r.datetime_utc}</td>
                <td>{r.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="ok">None.</p>}

      <h3>Conflicts</h3>
      {status && status.conflicts.length > 0 ? (
        <ul>
          {status.conflicts.map((c, i) => (
            <li key={i}>
              <strong>{c.type}</strong> on <span className="mono">{c.item_id}</span> — {c.detail}
            </li>
          ))}
        </ul>
      ) : <p className="ok">None.</p>}

      {status && status.nonContractEventTypes.length > 0 && (
        <>
          <h3>Non-contract event types</h3>
          <p className="warn small">
            These ledgers contain event types outside the manual&apos;s enum:{" "}
            <span className="mono">{status.nonContractEventTypes.join(", ")}</span>.
            They are read as identifier scans rather than dropped.
          </p>
        </>
      )}
    </div>
  );
}
