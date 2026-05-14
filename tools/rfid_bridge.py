#!/usr/bin/env python3
"""
RFID Bridge — Unitech RP902 (MFi or Standard) serial → WebSocket
================================================================
Reads EPC hex strings from RP902 via USB SPP or BT SPP serial port,
then broadcasts each EPC to the RFID Scan page via local WebSocket.

Usage:
    pip install pyserial websockets
    python3 rfid_bridge.py              # auto-detect port, WS on :8765
    python3 rfid_bridge.py --port /dev/tty.RP902-SerialPort
    python3 rfid_bridge.py --port COM3   # Windows USB SPP
    python3 rfid_bridge.py --baud 115200 --ws-port 8765

How RP902 MFi connects (Mac):
  1. Power on RP902 (1 beep = SPP mode, default)
  2. System Preferences → Bluetooth → pair the RP902
  3. After pairing: ls /dev/tty.* to find the port (e.g. /dev/tty.RP902-...)
  4. Run this script with that port
  5. Open http://localhost:5173/rfid-scan in browser → "Bridge connected"
  6. Pull trigger on RP902 → item appears

How RP902 MFi connects (Windows):
  1. Connect USB cable to PC
  2. Device Manager → Ports → note COM number (e.g. COM3)
  3. Run: python rfid_bridge.py --port COM3

EPC format expected from RP902 in SPP mode:
  24 uppercase hex chars per line (SGTIN-96), e.g. 301417153530094000000025
  The bridge strips all whitespace and filters for valid-looking EPCs.
"""

import argparse
import asyncio
import logging
import re
import sys
import time
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("rfid-bridge")

# WebSocket clients connected to this bridge
_ws_clients: set = set()

# ── Serial helpers ────────────────────────────────────────────────────────────

def list_serial_ports() -> list[str]:
    """Return available serial ports."""
    try:
        import serial.tools.list_ports  # type: ignore
        return [p.device for p in serial.tools.list_ports.comports()]
    except ImportError:
        import glob
        candidates = (
            glob.glob("/dev/tty.RP902*")
            + glob.glob("/dev/tty.Unitech*")
            + glob.glob("/dev/ttyUSB*")
            + glob.glob("/dev/ttyACM*")
            + [f"COM{i}" for i in range(1, 20)]
        )
        return [p for p in candidates if _port_exists(p)]


def _port_exists(port: str) -> bool:
    import os
    return os.path.exists(port)


def auto_detect_port() -> Optional[str]:
    """Try to find the RP902 port automatically."""
    ports = list_serial_ports()
    log.info(f"Available serial ports: {ports or ['none found']}")

    # Prefer RP902 / Unitech named ports
    for p in ports:
        name = p.lower()
        if "rp902" in name or "unitech" in name:
            return p

    # Fallback: first available port
    return ports[0] if ports else None


# ── EPC parsing ───────────────────────────────────────────────────────────────

_EPC_RE = re.compile(r"[0-9A-Fa-f]{24}")
_SGTIN_HEADER = 0x30
_SGLN_HEADER  = 0x32
_GCP_INT = int("0024204115")  # SEAR Lab GCP

def parse_epc(raw: str) -> Optional[str]:
    """
    Extract a 24-char hex EPC from raw serial line.
    Returns uppercase EPC or None if not a recognised SEAR Lab EPC.
    RP902 may output tag data with extra status bytes — we extract the hex portion.
    """
    raw = raw.strip()
    m = _EPC_RE.search(raw)
    if not m:
        return None
    epc_hex = m.group(0).upper()

    # Validate it looks like one of our SGTIN-96 or SGLN-96 EPCs
    try:
        val = int(epc_hex, 16)
        header = (val >> 88) & 0xFF
        partition = (val >> 82) & 0x7
        gcp = (val >> 52) & 0x3FFFFFFF
        if header in (_SGTIN_HEADER, _SGLN_HEADER) and partition == 5 and gcp == _GCP_INT:
            return epc_hex
        # Also accept unknown EPCs so user can register them
        return epc_hex
    except ValueError:
        return None


# ── WebSocket server ──────────────────────────────────────────────────────────

async def ws_handler(websocket):
    """Handle a browser WebSocket connection."""
    _ws_clients.add(websocket)
    remote = websocket.remote_address
    log.info(f"Browser connected from {remote} ({len(_ws_clients)} total)")
    try:
        async for _ in websocket:
            pass  # we only send, never receive
    finally:
        _ws_clients.discard(websocket)
        log.info(f"Browser disconnected ({len(_ws_clients)} remaining)")


async def broadcast(epc: str):
    """Send EPC to all connected browser clients."""
    if not _ws_clients:
        log.warning(f"EPC {epc} scanned but no browser connected — open /rfid-scan first")
        return
    import websockets
    dead = set()
    for ws in _ws_clients:
        try:
            await ws.send(epc)
        except websockets.exceptions.ConnectionClosed:
            dead.add(ws)
    _ws_clients.difference_update(dead)


# ── Serial reader ─────────────────────────────────────────────────────────────

async def read_serial(port: str, baud: int):
    """Async serial reader — blocks in executor to avoid blocking the event loop."""
    try:
        import serial  # type: ignore
    except ImportError:
        log.error("pyserial not installed. Run: pip install pyserial")
        sys.exit(1)

    log.info(f"Opening serial port {port} @ {baud} baud...")
    try:
        ser = serial.Serial(port, baud, timeout=1)
    except serial.SerialException as e:
        log.error(f"Cannot open {port}: {e}")
        sys.exit(1)

    log.info(f"Serial port open. Pull trigger on RP902 to scan.")
    loop = asyncio.get_event_loop()
    last_epc: Optional[str] = None
    last_time: float = 0

    while True:
        # Run blocking readline in thread pool
        try:
            raw = await loop.run_in_executor(None, ser.readline)
        except Exception as e:
            log.error(f"Serial read error: {e}")
            await asyncio.sleep(1)
            continue

        if not raw:
            continue

        line = raw.decode("ascii", errors="ignore")
        epc = parse_epc(line)
        if not epc:
            continue

        # Debounce: same EPC within 1 second = duplicate read, skip
        now = time.monotonic()
        if epc == last_epc and (now - last_time) < 1.0:
            continue
        last_epc = epc
        last_time = now

        log.info(f"EPC: {epc}")
        await broadcast(epc)


# ── Main ──────────────────────────────────────────────────────────────────────

async def main(port: Optional[str], baud: int, ws_port: int):
    try:
        import websockets  # type: ignore
    except ImportError:
        log.error("websockets not installed. Run: pip install websockets")
        sys.exit(1)

    # Find port if not specified
    if not port:
        port = auto_detect_port()
        if not port:
            log.error(
                "No serial port found. Pair RP902 via Bluetooth first, then:\n"
                "  Mac: ls /dev/tty.*  → find RP902 port\n"
                "  Win: Device Manager → Ports → find COM number\n"
                "Then run: python rfid_bridge.py --port <port>"
            )
            # List ports and exit
            ports = list_serial_ports()
            if ports:
                log.info(f"Available ports: {ports}")
            sys.exit(1)

    log.info(f"Starting WebSocket server on ws://localhost:{ws_port}")
    log.info(f"Open http://localhost:5173/rfid-scan — it connects automatically")

    async with websockets.serve(ws_handler, "localhost", ws_port):
        await read_serial(port, baud)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RFID Bridge: RP902 serial → WebSocket → browser")
    parser.add_argument("--port", help="Serial port (e.g. /dev/tty.RP902-... or COM3)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default 115200)")
    parser.add_argument("--ws-port", type=int, default=8765, help="WebSocket port (default 8765)")
    args = parser.parse_args()

    try:
        asyncio.run(main(args.port, args.baud, args.ws_port))
    except KeyboardInterrupt:
        log.info("Bridge stopped.")
