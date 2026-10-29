"""
ledger.py — shared helpers for the RAID Lab baseline ledger apps.

Standard library only, on purpose: this file must run on the embedded Python
runtime with zero installs. The canonical column schemas here are the API
contract between the Inventory, RFID, and Energy programs — see
LAB_SELF_HOSTING_MANUAL.md section 2 before changing anything.
"""
import csv
import hashlib
import json
import shutil
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

VERSION = "1.0-baseline"

EVENT_COLS = ["event_id", "device_id", "seq", "user", "datetime_utc",
              "event_type", "value", "location_context", "command_context",
              "reader_id", "antenna_id", "avg_rssi_dbm", "read_count",
              "window_start_utc", "window_end_utc", "confidence", "notes"]

ITEM_COLS = ["event_id", "item_id", "action", "description", "category",
             "gtin", "serial_number", "epc", "user", "datetime_utc"]

ENERGY_COLS = ["event_id", "device_id", "seq", "datetime_utc", "source_type",
               "source_id", "metric", "value", "unit", "quality", "notes"]


def now_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_config(path):
    """Tiny INI reader (section -> key -> value). Values kept as strings."""
    import configparser
    cp = configparser.ConfigParser()
    cp.read(path, encoding="utf-8-sig")   # -sig: tolerate Notepad's BOM
    return cp


class Ledger:
    """One append-only CSV owned by THIS device. Never edited, only appended.

    A threading lock serializes appends; seq is derived from the file so the
    counter survives restarts.
    """

    def __init__(self, path, columns, id_prefix):
        self.path = Path(path)
        self.columns = columns
        self.id_prefix = id_prefix          # e.g. "INV01" or "INV01-I"
        self._lock = threading.Lock()
        if not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "w", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow(columns)

    def rows(self):
        with open(self.path, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))

    def _next_seq(self):
        rows = self.rows()
        best = 0
        for r in rows:
            eid = r.get("event_id", "")
            if eid.startswith(self.id_prefix + "-"):
                tail = eid.rsplit("-", 1)[-1]
                if tail.isdigit():
                    best = max(best, int(tail))
        return best + 1

    def append(self, row):
        """Append one event. Fills event_id/seq/datetime if missing. Returns row."""
        with self._lock:
            seq = self._next_seq()
            row = dict(row)
            row.setdefault("seq", str(seq))
            row.setdefault("event_id", f"{self.id_prefix}-{seq:06d}")
            row.setdefault("datetime_utc", now_utc())
            with open(self.path, "a", newline="", encoding="utf-8") as f:
                csv.DictWriter(f, fieldnames=self.columns).writerow(
                    {c: row.get(c, "") for c in self.columns})
            return row


def read_csv_rows(path):
    try:
        with open(path, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    except Exception:
        return []


def merged_rows(local_paths, synced_dir, name_prefix):
    """Union of rows across our files + synced copies, deduped by event_id,
    deterministically ordered by (datetime_utc, device_id, seq)."""
    files = [Path(p) for p in local_paths if Path(p).exists()]
    sd = Path(synced_dir)
    if sd.exists():
        files += sorted(p for p in sd.glob(name_prefix + "*.csv"))
    rows, seen = [], set()
    for fp in files:
        for r in read_csv_rows(fp):
            eid = r.get("event_id", "")
            if eid and eid in seen:
                continue
            seen.add(eid)
            rows.append(r)
    def _key(r):
        try:
            s = int(r.get("seq") or 0)
        except ValueError:
            s = 0
        return (r.get("datetime_utc", ""), r.get("device_id", ""), s)
    rows.sort(key=_key)
    return rows


def sync_now(sync_folder, device_id, push_map, pull_specs, synced_dir):
    """push_map: {local_path: subpath_in_sync_folder}
       pull_specs: [(subdir, glob_pattern), ...] — copies others' files locally.
       Appends a manifest row per pushed file. Safe to call when offline
       (returns ok=False, nothing breaks)."""
    sf = Path(sync_folder) if sync_folder else None
    if not sf or not sf.exists():
        return {"ok": False, "error": f"sync folder not reachable: {sync_folder}"}
    pushed, pulled = [], 0
    for local, sub in push_map.items():
        lp = Path(local)
        if not lp.exists():
            continue
        dest = sf / sub
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(lp, dest)
        n_rows = max(0, sum(1 for _ in open(lp, encoding="utf-8")) - 1)
        mpath = sf / "manifest.csv"
        new = not mpath.exists()
        with open(mpath, "a", newline="", encoding="utf-8") as mf:
            w = csv.writer(mf)
            if new:
                w.writerow(["device_id", "file", "row_count",
                            "uploaded_at_utc", "program_version"])
            w.writerow([device_id, sub, n_rows, now_utc(), VERSION])
        pushed.append(sub)
    Path(synced_dir).mkdir(parents=True, exist_ok=True)
    for sub, pattern in pull_specs:
        d = sf / sub
        if not d.exists():
            continue
        for f in d.glob(pattern):
            if device_id in f.name:
                continue  # never pull our own file back over ourselves
            shutil.copy2(f, Path(synced_dir) / f.name)
            pulled += 1
    return {"ok": True, "pushed": pushed, "pulled": pulled, "at": now_utc()}


# ── GS1 / identifier helpers (Companion Book §3.2) ──────────────────────────

def gtin_check_digit_ok(g14):
    s = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(g14[:13]))
    return (10 - s % 10) % 10 == int(g14[13])


def normalize_gtin(code):
    """Accept GTIN-8/12/13/14, return zero-padded GTIN-14 or None."""
    if not code or not code.isdigit():
        return None
    if len(code) in (8, 12, 13, 14):
        g = code.zfill(14)
        if gtin_check_digit_ok(g):
            return g
    return None


def parse_gs1(code):
    """Minimal GS1 Application Identifier parse: handles '(01)…(21)…' and bare
    '01' + 14 digits [+ '21' + serial]. Returns dict or None.
    EXTENSION POINT: students add full AI table + GS1 Digital Link URLs here."""
    out = {}
    if code.startswith("(") and ")" in code:
        rest = code
        while rest.startswith("(") and ")" in rest:
            ai, rest = rest[1:].split(")", 1)
            nxt = rest.find("(")
            val = rest if nxt == -1 else rest[:nxt]
            rest = "" if nxt == -1 else rest[nxt:]
            out[ai] = val
        return out or None
    if code[:2] == "01" and len(code) >= 16 and code[2:16].isdigit():
        out["01"] = code[2:16]
        if code[16:18] == "21":
            out["21"] = code[18:]
        return out
    return None


def looks_like_epc(code):
    """SGTIN-96 style: 24 hex chars."""
    c = code.strip().upper()
    return len(c) == 24 and all(ch in "0123456789ABCDEF" for ch in c)


# ── Confidence score (Companion Book §8.2.3) ────────────────────────────────

def confidence_score(read_count, avg_rssi, w1=0.1, w2=1.5):
    """C = w1*RC + w2*(RSSI_avg + 90). Raw points; callers may normalize."""
    return w1 * float(read_count) + w2 * (float(avg_rssi) + 90.0)


# ── Tiny HTTP framework (stdlib http.server) ────────────────────────────────

def make_handler(routes, static_dir):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # keep the console quiet

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._route("GET")

        def do_POST(self):
            self._route("POST")

        def _route(self, method):
            u = urlparse(self.path)
            if method == "GET" and u.path in ("/", "/index.html"):
                fp = Path(static_dir) / "index.html"
                if fp.exists():
                    return self._send(200, fp.read_bytes(), "text/html; charset=utf-8")
            fn = routes.get((method, u.path))
            if not fn:
                return self._send(404, {"error": "no route: " + u.path})
            body = {}
            if method == "POST":
                ln = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(ln) if ln else b""
                if raw:
                    try:
                        body = json.loads(raw)
                    except Exception:
                        return self._send(400, {"error": "body must be JSON"})
            query = {k: v[0] for k, v in parse_qs(u.query).items()}
            try:
                code, resp = fn(query, body, self.headers)
                self._send(code, resp)
            except Exception as e:  # surface errors to the UI, don't crash
                self._send(500, {"error": f"{type(e).__name__}: {e}"})
    return Handler


def serve(port, routes, static_dir, bind="127.0.0.1", open_browser=True):
    srv = ThreadingHTTPServer((bind, port), make_handler(routes, static_dir))
    url = f"http://localhost:{port}"
    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    print(f"RAID Lab ledger app serving at {url}   (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("bye")
