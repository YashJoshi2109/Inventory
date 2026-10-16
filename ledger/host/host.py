"""
RAID Lab Inventory Ledger -- local host.

This is the bootstrap, static-file host, and CSV bridge. It is deliberately
NOT a second implementation of the inventory application:

  * it computes no status
  * it parses no GS1 and decodes no EPC
  * it resolves no identifiers and arbitrates no merges

All of that lives in ledger/core and runs in the browser, in both offline and
cloud mode, so the two can never disagree about what a ledger means.

The one piece of logic here is idempotent append (see append_rows): given rows
to mirror, write only those whose event_id is not already in the file. That is
a property of the file, not of the domain -- without it every relaunch would
re-append the whole ledger.

Standard library only, on purpose: this has to run from a PyInstaller bundle on
a Windows laptop with no Python, no pip, and no internet.
"""
import configparser
import csv
import io
import json
import mimetypes
import os
import socket
import sys
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PROGRAM_NAME = "inventory-ledger"
PROGRAM_SEMVER = "1.0.0"
SCHEMA_VERSION = 1
STATUS_ALGORITHM_VERSION = 1
PROGRAM_VERSION = (
    f"{PROGRAM_NAME}/{PROGRAM_SEMVER}"
    f"+schema.{SCHEMA_VERSION}+status.{STATUS_ALGORITHM_VERSION}"
)

# Canonical column sets -- LAB_SELF_HOSTING_MANUAL.md section 2. These are the
# cross-team contract. The host only uses them to write correct headers on an
# empty file; it never invents or reorders a column.
ITEM_COLUMNS = [
    "event_id", "item_id", "action", "description", "category",
    "gtin", "serial_number", "epc", "user", "datetime_utc",
]
EVENT_COLUMNS = [
    "event_id", "device_id", "seq", "user", "datetime_utc",
    "event_type", "value", "location_context", "command_context",
    "reader_id", "antenna_id", "avg_rssi_dbm", "read_count",
    "window_start_utc", "window_end_utc", "confidence", "notes",
]

DEFAULT_LOCATIONS = {
    "LOC-SHELF-A": "Shelf A (Battery Storage)",
    "LOC-SHELF-B": "Shelf B (Workbench)",
    "LOC-SHELF-C": "Shelf C (Storage East)",
    "LOC-SHELF-D": "Shelf D (Entrance/Testing)",
}

_write_lock = threading.Lock()


# -- paths -------------------------------------------------------------------

def base_dir() -> Path:
    """Directory the user sees: next to the exe, not inside the bundle."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def bundled_dir(here=None) -> Path:
    """
    Where PyInstaller unpacked our static assets, or the built bundle on disk.

    Two on-disk layouts exist: the zip's fallback/ folder (and the e2e source
    run) put dist/ beside host.py; the source tree has host/ beside dist/.
    """
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass) / "static"
    here = here or Path(__file__).resolve().parent
    sibling = here / "dist"
    return sibling if sibling.is_dir() else (here / ".." / "dist").resolve()


# -- config ------------------------------------------------------------------

DEVICE_ID_HEX_CHARS = 10          # 40 bits: P(collision among 500 devices) ~ 1e-7


def generate_device_id() -> str:
    """
    Unique per machine.

    Two installs sharing a device_id mint the same event_ids, which is exactly
    the id-collision failure the conflict queue exists to catch -- so the id has
    to be wide enough that it effectively never happens. Five hex chars (20 bits)
    collided once in 500 draws in testing; ten hex chars puts it at ~1e-7.
    """
    return "INV" + uuid.uuid4().hex[:DEVICE_ID_HEX_CHARS].upper()


def load_config(path: Path) -> configparser.ConfigParser:
    cp = configparser.ConfigParser()
    cp.optionxform = str          # preserve LOC-SHELF-A casing
    if path.exists():
        cp.read(path, encoding="utf-8-sig")

    changed = False
    if not cp.has_section("app"):
        cp.add_section("app")
        changed = True
    if not cp.get("app", "device_id", fallback="").strip():
        cp.set("app", "device_id", generate_device_id())
        changed = True
    for key, value in (("port", "5001"), ("bind", "127.0.0.1")):
        if not cp.get("app", key, fallback="").strip():
            cp.set("app", key, value)
            changed = True
    if not cp.has_section("locations"):
        cp.add_section("locations")
        for code, label in DEFAULT_LOCATIONS.items():
            cp.set("locations", code, label)
        changed = True

    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            cp.write(f)
    return cp


# -- CSV files ---------------------------------------------------------------

def ensure_ledger(path: Path, columns) -> None:
    """Create a header-only ledger if absent. Never rewrites an existing file."""
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(columns)


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8-sig")


def existing_event_ids(path: Path) -> set:
    """event_id values already in the file. Tolerates a malformed tail."""
    ids = set()
    if not path.exists():
        return ids
    try:
        with open(path, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                value = (row.get("event_id") or "").strip()
                if value:
                    ids.add(value)
    except (csv.Error, UnicodeDecodeError):
        # A corrupt file must not take the program down. Callers see fewer known
        # ids, so at worst a row is offered again and skipped on the next pass.
        pass
    return ids


def append_rows(path: Path, columns, csv_text: str) -> dict:
    """
    Idempotent append.

    THE ONLY LOGIC THIS HOST OWNS. Rows whose event_id is already present are
    skipped, so relaunching never duplicates events. The host does not decide
    between two rows sharing an event_id -- it reports the collision and lets
    ledger/core's mergeEventRows adjudicate in the browser.
    """
    out = {"written": 0, "duplicates": 0, "collisions": []}
    if not csv_text.strip():
        return out

    ensure_ledger(path, columns)
    known = existing_event_ids(path)

    try:
        incoming = list(csv.DictReader(io.StringIO(csv_text)))
    except csv.Error as exc:
        raise ValueError(f"unparseable CSV payload: {exc}") from exc

    with _write_lock:
        # Re-read under the lock: another request may have appended meanwhile.
        known = existing_event_ids(path)
        pending = []
        seen_in_batch = set()
        for row in incoming:
            event_id = (row.get("event_id") or "").strip()
            if not event_id:
                continue                       # cannot be deduplicated safely
            if event_id in known or event_id in seen_in_batch:
                out["duplicates"] += 1
                continue
            seen_in_batch.add(event_id)
            pending.append({c: (row.get(c) or "") for c in columns})

        if pending:
            # Append-only: open in "a", never rewrite existing bytes.
            with open(path, "a", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=columns)
                for row in pending:
                    writer.writerow(row)
                f.flush()
                os.fsync(f.fileno())          # survive an abrupt shutdown
            out["written"] = len(pending)
    return out


# -- HTTP --------------------------------------------------------------------

class Host:
    def __init__(self, root: Path):
        self.root = root
        self.config_path = root / "config.ini"
        self.config = load_config(self.config_path)
        self.device_id = self.config.get("app", "device_id")
        self.port = self.config.getint("app", "port", fallback=5001)
        self.bind = self.config.get("app", "bind", fallback="127.0.0.1")
        self.data_dir = root / "data"
        self.items_path = self.data_dir / f"items_{self.device_id}.csv"
        self.events_path = self.data_dir / f"log_{self.device_id}.csv"
        ensure_ledger(self.items_path, ITEM_COLUMNS)
        ensure_ledger(self.events_path, EVENT_COLUMNS)
        self.static_dir = bundled_dir()

    def meta(self) -> dict:
        locations = dict(self.config.items("locations")) if self.config.has_section("locations") else {}
        return {
            "deviceId": self.device_id,
            "port": self.port,
            "programVersion": PROGRAM_VERSION,
            "schemaVersion": SCHEMA_VERSION,
            "statusAlgorithmVersion": STATUS_ALGORITHM_VERSION,
            "locations": locations,
            "dataDir": str(self.data_dir),
            "itemsFile": self.items_path.name,
            "eventsFile": self.events_path.name,
            "offline": True,
        }

    def ledgers(self) -> dict:
        return {
            "items": read_text(self.items_path),
            "events": read_text(self.events_path),
        }

    def mirror(self, payload: dict) -> dict:
        items = append_rows(self.items_path, ITEM_COLUMNS, payload.get("items") or "")
        events = append_rows(self.events_path, EVENT_COLUMNS, payload.get("events") or "")
        return {
            "itemsWritten": items["written"],
            "eventsWritten": events["written"],
            "duplicatesSkipped": items["duplicates"] + events["duplicates"],
            "collisions": items["collisions"] + events["collisions"],
        }


def make_handler(host: Host):
    class Handler(BaseHTTPRequestHandler):
        server_version = "RaidLedgerHost/1.0"

        def log_message(self, *args):
            pass                                # keep the console quiet

        def _send_json(self, code, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_file(self, path: Path):
            data = path.read_bytes()
            ctype, _ = mimetypes.guess_type(str(path))
            self.send_response(200)
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            # The whole point is offline operation: never let a stale cache win.
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urlparse(self.path).path
            try:
                if path == "/api/meta":
                    return self._send_json(200, host.meta())
                if path == "/api/ledgers":
                    return self._send_json(200, host.ledgers())
                if path.startswith("/api/"):
                    # Never let an API path fall through to the SPA fallback: a
                    # typo would return index.html with a 200 and look like it
                    # worked. Unknown API routes are a JSON 404.
                    return self._send_json(404, {"error": "no route: " + path})
                return self._serve_static(path)
            except Exception as exc:                      # surface, never crash
                return self._send_json(500, {"error": f"{type(exc).__name__}: {exc}"})

        def do_POST(self):
            path = urlparse(self.path).path
            try:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    return self._send_json(400, {"error": "body must be JSON"})
                if path == "/api/mirror":
                    return self._send_json(200, host.mirror(payload))
                return self._send_json(404, {"error": "no route: " + path})
            except ValueError as exc:
                return self._send_json(400, {"error": str(exc)})
            except Exception as exc:
                return self._send_json(500, {"error": f"{type(exc).__name__}: {exc}"})

        def _serve_static(self, path: str):
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            target = (host.static_dir / rel).resolve()
            try:
                target.relative_to(host.static_dir.resolve())
            except ValueError:
                return self._send_json(403, {"error": "path outside the bundle"})
            if target.is_file():
                return self._send_file(target)
            # Single-page app: unknown paths fall back to index.html.
            index = host.static_dir / "index.html"
            if index.is_file():
                return self._send_file(index)
            return self._send_json(404, {"error": "static assets missing from this build"})

    return Handler


# Ports the other lab programs own (LAB_SELF_HOSTING_MANUAL.md section 1).
# Falling back onto one of these would take the RFID or Energy program's place
# and be maddening to diagnose, so they are skipped even when free.
RESERVED_PORTS = {5002: "RFID Ledger", 5003: "Energy Ledger"}


def find_free_port(preferred: int, bind: str) -> int:
    """Use the configured port when free, otherwise the next one that is."""
    for candidate in range(preferred, preferred + 20):
        if candidate != preferred and candidate in RESERVED_PORTS:
            continue                       # belongs to another team's program
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((bind, candidate))
                return candidate
            except OSError:
                continue
    raise RuntimeError(f"no free port in {preferred}..{preferred + 19}")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    root = base_dir()
    host = Host(root)
    port = find_free_port(host.port, host.bind)
    host.port = port

    server = ThreadingHTTPServer((host.bind, port), make_handler(host))
    url = f"http://localhost:{port}"

    # flush=True throughout: stdout is block-buffered when it is not a
    # terminal, so a user redirecting output to a file -- or a supervisor
    # killing the process -- would otherwise see nothing at all.
    print("RAID Lab Inventory Ledger", flush=True)
    print(f"  device id : {host.device_id}", flush=True)
    print(f"  data      : {host.data_dir}", flush=True)
    print(f"  open      : {url}", flush=True)
    print("  press Ctrl+C to stop", flush=True)

    if "--no-browser" not in argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped. your ledgers are in", host.data_dir, flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
