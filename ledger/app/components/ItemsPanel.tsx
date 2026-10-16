import { useRef, useState } from "react";
import type { CatalogImportReport, LedgerService } from "../../service/ledgerService.ts";
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
  const [report, setReport] = useState<CatalogImportReport | null>(null);
  const [pin, setPin] = useState("");
  const [adminOpen, setAdminOpen] = useState(service.isAdminUnlocked());

  /** Manual §4: revise and retire are PIN-gated. The service holds the lock. */
  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const ok = await service.unlockAdmin(pin);
      setAdminOpen(ok);
      setPin("");
      if (!ok) setError("that PIN does not match config.ini");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function retire(itemId: string) {
    setError(null);
    try {
      await service.reviseItem(itemId, "retire", {});
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  const [pending, setPending] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Import the lab's catalog sheet: SEAR Lab Item Catalog.xlsx, Catalog tab,
   * downloaded as CSV. A dry run first, so nobody imports 141 rows blind.
   */
  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setReport(null); setPending(null);
    try {
      const text = await file.text();
      setReport(await service.importCatalog(text, { dryRun: true }));
      setPending(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmImport() {
    if (!pending) return;
    setError(null);
    try {
      setReport(await service.importCatalog(pending));
      setPending(null);
      if (fileRef.current) fileRef.current.value = "";
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

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
      <div className="import">
        <label htmlFor="catalog-file">
          Import the lab catalog sheet (Catalog tab, downloaded as CSV)
        </label>
        <input id="catalog-file" ref={fileRef} type="file" accept=".csv,text/csv"
               onChange={pickFile} aria-label="catalog csv" />
        {report && (
          <div className="report">
            <ul>
              <li>{report.newItems} new {report.newItems === 1 ? "item" : "items"}</li>
              <li>{report.alreadyPresent} already in the master</li>
              {report.withoutLocation > 0 && (
                <li className="warn">
                  {report.withoutLocation} with no location — imported, but their status
                  stays unknown rather than being placed somewhere plausible
                </li>
              )}
              {report.unmappedLocations.length > 0 && (
                <li className="warn">
                  not a printed place label: {report.unmappedLocations.join(", ")}
                </li>
              )}
            </ul>
            {report.dryRun
              ? <button type="button" onClick={confirmImport} disabled={!report.newItems}>
                  Import {report.newItems} {report.newItems === 1 ? "row" : "rows"}
                </button>
              : <p className="ok">Imported. Nothing was edited or deleted.</p>}
          </div>
        )}
      </div>

      {adminOpen ? (
        <p className="ok">
          Admin unlocked — retire is available.{" "}
          <button type="button" className="ghost"
                  onClick={() => { service.lockAdmin(); setAdminOpen(false); }}>
            Lock
          </button>
        </p>
      ) : (
        <form onSubmit={unlock} className="import">
          <label htmlFor="admin-pin">Admin PIN (needed to revise or retire an item)</label>
          <input id="admin-pin" type="password" value={pin} aria-label="admin pin"
                 onChange={(e) => setPin(e.target.value)} />
          <button type="submit" disabled={!pin}>Unlock</button>
        </form>
      )}

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
            {adminOpen && <th>admin</th>}
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
              {adminOpen && (
                <td>
                  {r.action === "retire" ? null : (
                    <button type="button" className="ghost"
                            onClick={() => retire(r.item_id)}>
                      Retire
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
