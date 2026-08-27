import type { EventRow } from "../../service/types.ts";

/**
 * The raw event log, newest first. View-only: the ledger is append-only, so
 * there is deliberately nothing here that edits a row.
 */
export function LogPanel({ events }: { events: EventRow[] }) {
  const rows = [...events].reverse();
  return (
    <div className="panel">
      <p className="muted small">
        {events.length} event{events.length === 1 ? "" : "s"}. Newest first.
        Nothing here can be edited or deleted — corrections are new rows.
      </p>
      <table>
        <thead>
          <tr>
            <th>event_id</th><th>time (UTC)</th><th>type</th><th>value</th>
            <th>location</th><th>command</th><th>user</th><th>notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.event_id}>
              <td className="mono">{r.event_id}</td>
              <td className="mono">{r.datetime_utc}</td>
              <td>{r.event_type}</td>
              <td className="mono">{r.value}</td>
              <td className="mono">{r.location_context}</td>
              <td>{r.command_context}</td>
              <td>{r.user}</td>
              <td className="muted small">{r.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
