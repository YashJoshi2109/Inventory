import { useState } from "react";
import type { LedgerService } from "../../service/ledgerService.ts";
import type { ItemRow } from "../../service/types.ts";

/**
 * Item master: register an item, and view the append-only master ledger.
 *
 * GTIN validation happens in ledger/core via the service. This file only shows
 * the error it is given -- it does not know what a check digit is.
 */
export function ItemsPanel({
  service, items, onChanged,
}: { service: LedgerService; items: ItemRow[]; onChanged: () => void }) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [gtin, setGtin] = useState("");
  const [serial, setSerial] = useState("");
  const [epc, setEpc] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await service.addItem({
        description, category, gtin, serial_number: serial, epc,
      });
      setDescription(""); setCategory(""); setGtin(""); setSerial(""); setEpc("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="panel">
      <form onSubmit={submit} className="itemform">
        <input value={description} onChange={(e) => setDescription(e.target.value)}
               placeholder="description (required)" aria-label="description" />
        <input value={category} onChange={(e) => setCategory(e.target.value)}
               placeholder="category" aria-label="category" />
        <input value={gtin} onChange={(e) => setGtin(e.target.value)}
               placeholder="GTIN" aria-label="gtin" />
        <input value={serial} onChange={(e) => setSerial(e.target.value)}
               placeholder="serial number" aria-label="serial number" />
        <input value={epc} onChange={(e) => setEpc(e.target.value)}
               placeholder="EPC" aria-label="epc" />
        <button type="submit" disabled={!description.trim()}>Register item</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      <p className="muted small">
        {items.length} row{items.length === 1 ? "" : "s"} in the item master.
        Rows are appended, never edited — a revision adds a row and the latest wins.
      </p>

      <table>
        <thead>
          <tr>
            <th>event_id</th><th>item_id</th><th>action</th><th>description</th>
            <th>GTIN</th><th>serial</th><th>EPC</th><th>by</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.event_id}>
              <td className="mono">{r.event_id}</td>
              <td className="mono">{r.item_id}</td>
              <td>{r.action}</td>
              <td>{r.description}</td>
              <td className="mono">{r.gtin}</td>
              <td className="mono">{r.serial_number}</td>
              <td className="mono">{r.epc}</td>
              <td>{r.user}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
