"""
Inventory Ledger — the MASTER program of the RAID Lab ledger platform (port 5001).

Owns the Item Master ledger. Ingests barcode scans (keyboard-wedge first),
runs the status algorithm over ALL synced ledgers (barcode + RFID observations
+ corrections), publishes reconciled checkpoints.

Run:  python app.py            (opens browser at http://localhost:5001)
      python app.py --no-browser

EXTENSION POINTS for students (search this tag): camera scanning UI, GS1
Digital Link, richer status logic, MQTT republishing, AI copilot — all live
ABOVE this file; the ledger schemas must not change.
"""
import os
import sys
import threading
import time
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
os.chdir(APP_DIR)
sys.path.insert(0, str(APP_DIR))

import ledger as L

CFG = L.load_config("config.ini")
DEVICE = CFG.get("app", "device_id", fallback="INV01")
PORT = CFG.getint("app", "port", fallback=5001)
SYNC_FOLDER = CFG.get("app", "sync_folder", fallback="").strip()
ADMIN_PIN_HASH = CFG.get("app", "admin_pin_sha256", fallback=L.sha256("2026"))
ARM_SECONDS = CFG.getint("app", "location_arm_seconds", fallback=60)
AMBIGUITY_S = CFG.getint("app", "conflict_ambiguity_seconds", fallback=10)

LOCATIONS = dict(CFG.items("locations")) if CFG.has_section("locations") else {}
# location codes are case-insensitive on scan
LOC_LOOKUP = {k.upper(): v for k, v in LOCATIONS.items()}

DATA = APP_DIR / "data"
SYNCED = DATA / "synced"
items_ledger = L.Ledger(DATA / f"items_{DEVICE}.csv", L.ITEM_COLS, f"{DEVICE}-I")
event_ledger = L.Ledger(DATA / f"log_{DEVICE}.csv", L.EVENT_COLS, DEVICE)

# armed location per user: {user: (loc_code, expires_epoch)}
_armed = {}
_armed_lock = threading.Lock()


# ── merged views ─────────────────────────────────────────────────────────────

def all_item_rows():
    return L.merged_rows([items_ledger.path], SYNCED, "items_")


def all_event_rows():
    return L.merged_rows([event_ledger.path], SYNCED, "log_")


def all_energy_rows():
    return L.merged_rows([], SYNCED, "energy_")


def item_registry():
    """Latest row per item_id wins. Returns (by_item_id, by_identifier)."""
    by_id = {}
    for r in all_item_rows():                     # rows are time-ordered
        if r.get("item_id"):
            by_id[r["item_id"]] = r
    ident = {}
    for it in by_id.values():
        for key in ("gtin", "epc", "serial_number", "item_id"):
            v = (it.get(key) or "").strip().upper()
            if v:
                ident[v] = it
    return by_id, ident


def classify_scan(raw):
    """→ (kind, canonical_value). kind ∈ location|epc|gtin|serial|unknown."""
    code = raw.strip()
    up = code.upper()
    if up in LOC_LOOKUP:
        return "location", up
    gs1 = L.parse_gs1(code)
    if gs1 and gs1.get("01"):
        g = L.normalize_gtin(gs1["01"])
        if g:
            return "gtin", g
    if L.looks_like_epc(code):
        return "epc", up
    g = L.normalize_gtin(code)
    if g:
        return "gtin", g
    return "serial", up   # resolved (or not) against the registry later


# ── status algorithm: pure function of the ledgers ───────────────────────────

def compute_status():
    by_id, ident = item_registry()
    events = all_event_rows()

    voided = set()
    for ev in events:
        if ev.get("event_type") == "correction" and ev.get("command_context") == "void":
            voided.add(ev.get("value", ""))

    status = {}      # item_id -> dict
    unknowns = []    # scans that resolve to no item

    def parse_ts(s):
        try:
            from datetime import datetime
            return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").timestamp()
        except Exception:
            return 0.0

    AUTHORITATIVE = ("place", "checkout", "return")

    for ev in events:
        et = ev.get("event_type", "")
        if et in ("correction", "confirmation", "location", "command"):
            continue
        if ev.get("event_id") in voided:
            continue
        val = (ev.get("value") or "").strip().upper()
        item = ident.get(val)
        if item is None and et in ("gtin", "epc", "serial", "observation"):
            unknowns.append(ev)
            continue
        if item is None:
            continue
        iid = item["item_id"]
        st = status.setdefault(iid, {"item_id": iid, "conflict": False})
        prev_ts, prev_dev = st.get("_ts", 0.0), st.get("_dev", "")
        ts = parse_ts(ev.get("datetime_utc", ""))
        cmd = ev.get("command_context", "")

        if et == "observation":
            # RFID observation: corroborates or updates zone, marked by source
            st.update(state=f"in {ev.get('location_context') or 'unknown zone'}",
                      location=ev.get("location_context", ""),
                      source="rfid",
                      confidence=ev.get("confidence", ""),
                      last_user=ev.get("user", "") or ev.get("reader_id", ""))
        elif cmd == "checkout":
            st.update(state=f"checked out by {ev.get('user') or '?'}",
                      location="", source="barcode", confidence="",
                      last_user=ev.get("user", ""))
        elif cmd == "return":
            st.update(state="returned (unplaced)", location="",
                      source="barcode", confidence="", last_user=ev.get("user", ""))
        elif ev.get("location_context"):
            loc = ev["location_context"]
            st.update(state=f"on {LOC_LOOKUP.get(loc.upper(), loc)}",
                      location=loc, source="barcode", confidence="",
                      last_user=ev.get("user", ""))
        else:
            st.setdefault("state", "seen (location unknown)")
            st["last_user"] = ev.get("user", "")

        # near-simultaneous authoritative events from different devices → conflict
        if (cmd in AUTHORITATIVE and prev_dev and
                prev_dev != ev.get("device_id") and abs(ts - prev_ts) <= AMBIGUITY_S):
            st["conflict"] = True
        if cmd in AUTHORITATIVE or et == "observation":
            st["_ts"], st["_dev"] = ts, ev.get("device_id", "")
        st["last_seen"] = ev.get("datetime_utc", "")
        st["last_event_id"] = ev.get("event_id", "")

    out = []
    for iid, it in sorted(by_id.items()):
        st = status.get(iid, {})
        retired = it.get("action") == "retire"
        out.append({
            "item_id": iid,
            "description": it.get("description", ""),
            "category": it.get("category", ""),
            "gtin": it.get("gtin", ""),
            "serial_number": it.get("serial_number", ""),
            "epc": it.get("epc", ""),
            "state": "RETIRED" if retired else st.get("state", "never seen"),
            "location": st.get("location", ""),
            "source": st.get("source", ""),
            "confidence": st.get("confidence", ""),
            "conflict": st.get("conflict", False),
            "last_seen": st.get("last_seen", ""),
            "last_user": st.get("last_user", ""),
            "last_event_id": st.get("last_event_id", ""),
        })
    return out, unknowns


# ── routes ───────────────────────────────────────────────────────────────────

def check_pin(body):
    return L.sha256(str(body.get("pin", ""))) == ADMIN_PIN_HASH


def r_meta(q, b, h):
    return 200, {"device_id": DEVICE, "version": L.VERSION, "port": PORT,
                 "locations": LOCATIONS, "sync_folder": SYNC_FOLDER,
                 "sync_reachable": bool(SYNC_FOLDER and Path(SYNC_FOLDER).exists())}


def r_status(q, b, h):
    rows, unknowns = compute_status()
    return 200, {"status": rows, "unknown_scans": unknowns[-50:],
                 "generated_at": L.now_utc()}


def r_events(q, b, h):
    rows = all_event_rows()
    return 200, {"events": rows[-int(q.get("limit", 500)):]}


def r_items(q, b, h):
    return 200, {"items": all_item_rows()}


def r_energy(q, b, h):
    rows = all_energy_rows()
    latest = {}
    for r in rows:
        latest[(r.get("source_type"), r.get("source_id"), r.get("metric"))] = r
    return 200, {"latest": sorted(latest.values(),
                                  key=lambda r: (r.get("source_type", ""), r.get("metric", ""))),
                 "total_rows": len(rows)}


def r_scan(q, b, h):
    user = (b.get("user") or "").strip()
    raw = (b.get("value") or "").strip()
    mode = b.get("mode", "auto")            # auto | checkout | return
    if not user:
        return 400, {"error": "log in with your name first"}
    if not raw:
        return 400, {"error": "empty scan"}
    kind, val = classify_scan(raw)

    if kind == "location":
        with _armed_lock:
            _armed[user] = (val, time.time() + ARM_SECONDS)
        event_ledger.append({"device_id": DEVICE, "user": user,
                             "event_type": "location", "value": val})
        return 200, {"result": "armed", "location": val,
                     "location_name": LOC_LOOKUP.get(val, val),
                     "arm_seconds": ARM_SECONDS}

    _, ident = item_registry()
    item = ident.get(val)
    loc, cmd = "", ""
    if mode == "checkout":
        cmd = "checkout"
    elif mode == "return":
        cmd = "return"
    else:
        with _armed_lock:
            armed = _armed.get(user)
            if armed and armed[1] > time.time():
                loc, cmd = armed[0], "place"
    row = event_ledger.append({
        "device_id": DEVICE, "user": user, "event_type": kind, "value": val,
        "location_context": loc, "command_context": cmd,
        "notes": "" if item else "unknown identifier",
    })
    return 200, {"result": "logged", "event": row, "kind": kind,
                 "known_item": bool(item),
                 "item": {k: item[k] for k in ("item_id", "description")} if item else None,
                 "applied": cmd or "seen",
                 "location": loc}


def r_item_add(q, b, h):
    user = (b.get("user") or "").strip()
    desc = (b.get("description") or "").strip()
    if not user or not desc:
        return 400, {"error": "user and description required"}
    by_id, _ = item_registry()
    n = 1 + max((int(i.split("-")[1]) for i in by_id if i.startswith("ITM-")
                 and i.split("-")[1].isdigit()), default=0)
    gtin = (b.get("gtin") or "").strip()
    if gtin and not L.normalize_gtin(gtin):
        return 400, {"error": f"'{gtin}' fails the GTIN check digit (Book §3.2)"}
    row = items_ledger.append({
        "item_id": f"ITM-{n:04d}", "action": "add", "description": desc,
        "category": (b.get("category") or "").strip(),
        "gtin": L.normalize_gtin(gtin) or "",
        "serial_number": (b.get("serial_number") or "").strip(),
        "epc": (b.get("epc") or "").strip().upper(),
        "user": user,
    })
    return 200, {"result": "added", "item": row}


def r_admin_void(q, b, h):
    if not check_pin(b):
        return 403, {"error": "bad admin PIN"}
    target = (b.get("event_id") or "").strip()
    if not target:
        return 400, {"error": "event_id required"}
    row = event_ledger.append({
        "device_id": DEVICE, "user": "admin", "event_type": "correction",
        "value": target, "command_context": "void",
        "notes": b.get("reason", ""),
    })
    return 200, {"result": "voided", "correction": row}


def r_admin_item(q, b, h):
    """Admin revise/retire: appends a new item row; latest row per item wins."""
    if not check_pin(b):
        return 403, {"error": "bad admin PIN"}
    by_id, _ = item_registry()
    iid = (b.get("item_id") or "").strip()
    cur = by_id.get(iid)
    if not cur:
        return 404, {"error": f"unknown item {iid}"}
    action = b.get("action", "revise")
    if action not in ("revise", "retire"):
        return 400, {"error": "action must be revise|retire"}
    row = items_ledger.append({
        "item_id": iid, "action": action,
        "description": (b.get("description") or cur["description"]).strip(),
        "category": (b.get("category") or cur["category"]).strip(),
        "gtin": (b.get("gtin") or cur["gtin"]).strip(),
        "serial_number": (b.get("serial_number") or cur["serial_number"]).strip(),
        "epc": (b.get("epc") or cur["epc"]).strip().upper(),
        "user": "admin",
    })
    return 200, {"result": action, "item": row}


def do_sync():
    return L.sync_now(
        SYNC_FOLDER, DEVICE,
        push_map={str(items_ledger.path): f"items/items_{DEVICE}.csv",
                  str(event_ledger.path): f"logs/log_{DEVICE}.csv"},
        pull_specs=[("items", "items_*.csv"), ("logs", "log_*.csv"),
                    ("logs", "energy_*.csv")],
        synced_dir=SYNCED)


def r_sync(q, b, h):
    return 200, do_sync()


def r_admin_reconcile(q, b, h):
    if not check_pin(b):
        return 403, {"error": "bad admin PIN"}
    sf = Path(SYNC_FOLDER) if SYNC_FOLDER else None
    if not sf or not sf.exists():
        return 400, {"error": "sync folder not reachable"}
    import csv as _csv
    stamp = L.now_utc().replace(":", "").replace("-", "")[:13]
    rec = sf / "reconciled"
    rec.mkdir(exist_ok=True)

    def dump(name, cols, rows):
        p = rec / f"{name}_{stamp}.csv"
        with open(p, "w", newline="", encoding="utf-8") as f:
            w = _csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for r in rows:
                w.writerow({c: r.get(c, "") for c in cols})
        return p.name

    f1 = dump("items_master", L.ITEM_COLS, all_item_rows())
    f2 = dump("event_log", L.EVENT_COLS, all_event_rows())
    st, _ = compute_status()
    cols = list(st[0].keys()) if st else ["item_id"]
    f3 = dump("status", cols, st)
    return 200, {"result": "reconciled", "files": [f1, f2, f3]}


ROUTES = {
    ("GET", "/api/meta"): r_meta,
    ("GET", "/api/status"): r_status,
    ("GET", "/api/events"): r_events,
    ("GET", "/api/items"): r_items,
    ("GET", "/api/energy"): r_energy,
    ("POST", "/api/scan"): r_scan,
    ("POST", "/api/items/add"): r_item_add,
    ("POST", "/api/sync"): r_sync,
    ("POST", "/api/admin/void"): r_admin_void,
    ("POST", "/api/admin/item"): r_admin_item,
    ("POST", "/api/admin/reconcile"): r_admin_reconcile,
}


def auto_sync_loop():
    while True:
        do_sync()          # silently no-ops when folder unreachable
        time.sleep(300)


if __name__ == "__main__":
    threading.Thread(target=auto_sync_loop, daemon=True).start()
    L.serve(PORT, ROUTES, APP_DIR / "static",
            bind=CFG.get("app", "bind", fallback="127.0.0.1"),
            open_browser="--no-browser" not in sys.argv)
