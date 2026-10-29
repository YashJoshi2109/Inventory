import type { StatusView } from "../../service/types.ts";

/**
 * The derived status view -- "where is everything right now".
 *
 * Rendering only. The rows arrive already computed by ledger/core; this file
 * contains no status rules, no ordering, and no resolution logic.
 */
export function StatusTable({ status }: { status: StatusView | null }) {
  if (!status) return <p className="muted">Loading…</p>;
  if (status.rows.length === 0) {
    return <p className="muted">No items registered yet. Add one on the Items tab.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Item</th><th>Description</th><th>Status</th>
          <th>Confidence</th><th>Source</th><th>Last seen</th><th>By</th>
        </tr>
      </thead>
      <tbody>
        {status.rows.map((r) => (
          <tr key={r.item_id} className={r.status === "conflict" ? "row-conflict" : ""}>
            <td className="mono">{r.item_id}</td>
            <td>{r.description || <span className="muted">—</span>}</td>
            <td>{r.status_label}</td>
            <td>
              <span className={`chip chip-${r.confidence}`}>{r.confidence}</span>
              {r.rfid_confidence !== null && (
                <span className="muted"> {r.rfid_confidence.toFixed(2)}</span>
              )}
            </td>
            <td>{r.source || <span className="muted">—</span>}</td>
            <td className="mono">{r.last_seen_utc || <span className="muted">never</span>}</td>
            <td>{r.last_user || <span className="muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
