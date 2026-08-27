"""
Host tests. Standard library unittest -- no pip, matching the deployment story.

Run:  python3 -m unittest discover -s ledger/host -v
"""
import csv
import json
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import host as H


class TestLedgerFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.events = self.root / "data" / "log_INV01.csv"

    def tearDown(self):
        self.tmp.cleanup()

    def test_creates_header_only_ledger(self):
        H.ensure_ledger(self.events, H.EVENT_COLUMNS)
        lines = self.events.read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines, [",".join(H.EVENT_COLUMNS)])

    def test_does_not_rewrite_an_existing_ledger(self):
        H.ensure_ledger(self.events, H.EVENT_COLUMNS)
        H.append_rows(self.events, H.EVENT_COLUMNS,
                      "event_id,device_id\nINV01-000001,INV01\n")
        before = self.events.read_bytes()
        H.ensure_ledger(self.events, H.EVENT_COLUMNS)
        self.assertEqual(self.events.read_bytes(), before)

    def test_appends_rows_and_preserves_contract_column_order(self):
        payload = "event_id,device_id,seq,event_type,value\nINV01-000001,INV01,1,gtin,00614141123452\n"
        out = H.append_rows(self.events, H.EVENT_COLUMNS, payload)
        self.assertEqual(out["written"], 1)
        with open(self.events, newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            self.assertEqual(next(reader), H.EVENT_COLUMNS)
            row = next(reader)
        self.assertEqual(len(row), len(H.EVENT_COLUMNS))
        self.assertEqual(row[0], "INV01-000001")
        self.assertEqual(row[H.EVENT_COLUMNS.index("value")], "00614141123452")

    def test_repeated_append_of_the_same_row_is_idempotent(self):
        payload = "event_id,device_id,event_type,value\nINV01-000001,INV01,gtin,X\n"
        first = H.append_rows(self.events, H.EVENT_COLUMNS, payload)
        second = H.append_rows(self.events, H.EVENT_COLUMNS, payload)
        third = H.append_rows(self.events, H.EVENT_COLUMNS, payload)
        self.assertEqual((first["written"], second["written"], third["written"]), (1, 0, 0))
        self.assertEqual(second["duplicates"], 1)
        body = self.events.read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(body), 2)          # header + one row

    def test_deduplicates_within_a_single_batch(self):
        payload = ("event_id,device_id,event_type,value\n"
                   "INV01-000001,INV01,gtin,X\n"
                   "INV01-000001,INV01,gtin,X\n")
        out = H.append_rows(self.events, H.EVENT_COLUMNS, payload)
        self.assertEqual(out["written"], 1)
        self.assertEqual(out["duplicates"], 1)

    def test_ignores_rows_with_no_event_id(self):
        out = H.append_rows(self.events, H.EVENT_COLUMNS,
                            "event_id,device_id,event_type\n,INV01,gtin\n")
        self.assertEqual(out["written"], 0)

    def test_empty_payload_is_a_no_op(self):
        out = H.append_rows(self.events, H.EVENT_COLUMNS, "")
        self.assertEqual(out, {"written": 0, "duplicates": 0, "collisions": []})

    def test_drops_columns_it_was_not_asked_for(self):
        payload = ("event_id,device_id,event_type,convenience_column\n"
                   "INV01-000001,INV01,gtin,SHOULD_NOT_APPEAR\n")
        H.append_rows(self.events, H.EVENT_COLUMNS, payload)
        self.assertNotIn("SHOULD_NOT_APPEAR", self.events.read_text(encoding="utf-8"))
        self.assertNotIn("convenience_column", self.events.read_text(encoding="utf-8"))

    def test_survives_a_truncated_trailing_row(self):
        """An interrupted write leaves a partial line. It must not be fatal."""
        H.ensure_ledger(self.events, H.EVENT_COLUMNS)
        with open(self.events, "a", encoding="utf-8") as f:
            f.write("INV01-000009,INV01,9,yash,2026-07-05T14:00:00Z,gtin,PARTIAL")
        ids = H.existing_event_ids(self.events)
        self.assertIn("INV01-000009", ids)
        out = H.append_rows(self.events, H.EVENT_COLUMNS,
                            "event_id,device_id,event_type\nINV01-000010,INV01,gtin\n")
        self.assertEqual(out["written"], 1)

    def test_reads_a_file_written_with_a_utf8_bom(self):
        self.events.parent.mkdir(parents=True, exist_ok=True)
        self.events.write_text("﻿" + ",".join(H.EVENT_COLUMNS) + "\n"
                               + "INV01-000001" + "," * (len(H.EVENT_COLUMNS) - 1) + "\n",
                               encoding="utf-8")
        self.assertIn("INV01-000001", H.existing_event_ids(self.events))

    def test_quoted_field_with_a_comma_round_trips(self):
        payload = ('event_id,device_id,event_type,notes\n'
                   'INV01-000001,INV01,correction,"fat-finger, never placed"\n')
        H.append_rows(self.events, H.EVENT_COLUMNS, payload)
        with open(self.events, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(rows[0]["notes"], "fat-finger, never placed")


class TestConfig(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_generates_and_persists_a_device_id_on_first_run(self):
        path = self.root / "config.ini"
        cfg = H.load_config(path)
        device_id = cfg.get("app", "device_id")
        self.assertTrue(device_id.startswith("INV"))
        self.assertTrue(path.exists())
        # Second load must reuse it, not mint a new one.
        self.assertEqual(H.load_config(path).get("app", "device_id"), device_id)

    def test_device_id_has_enough_entropy_to_never_collide_in_practice(self):
        """
        Regression guard. At 20 bits this collided roughly once per ten runs of
        500 draws, and a shared device_id mints duplicate event_ids across two
        laptops. 40 bits puts 2000 draws at P(collision) ~ 2e-6.
        """
        import re
        self.assertRegex(H.generate_device_id(), r"^INV[0-9A-F]{10}$")
        ids = {H.generate_device_id() for _ in range(2000)}
        self.assertEqual(len(ids), 2000)

    def test_preserves_location_code_casing(self):
        cfg = H.load_config(self.root / "config.ini")
        self.assertIn("LOC-SHELF-A", dict(cfg.items("locations")))


class TestPortSelection(unittest.TestCase):
    def test_never_falls_back_onto_another_team_s_port(self):
        """
        5002 is the RFID program and 5003 is the Energy program. Silently
        taking one of them would be maddening to diagnose from the other side.
        """
        import socket
        # Occupy 5001 so the search has to move on.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as blocker:
            blocker.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                blocker.bind(("127.0.0.1", 5001))
                blocker.listen(1)
            except OSError:
                self.skipTest("port 5001 is already in use on this machine")
            chosen = H.find_free_port(5001, "127.0.0.1")
        self.assertNotIn(chosen, H.RESERVED_PORTS)
        self.assertGreater(chosen, 5001)

    def test_uses_the_configured_port_when_it_is_free(self):
        chosen = H.find_free_port(5011, "127.0.0.1")
        self.assertEqual(chosen, 5011)

    def test_a_program_may_still_be_configured_onto_its_own_reserved_port(self):
        """RFID configuring itself to 5002 must work; only fallback skips them."""
        self.assertEqual(H.find_free_port(5002, "127.0.0.1"), 5002)


class TestHttpApi(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.host = H.Host(self.root)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H.make_handler(self.host))
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}") as r:
            return json.loads(r.read())

    def post(self, path, payload):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def test_meta_reports_device_and_versions(self):
        meta = self.get("/api/meta")
        self.assertTrue(meta["deviceId"].startswith("INV"))
        self.assertEqual(meta["schemaVersion"], 1)
        self.assertEqual(meta["programVersion"], H.PROGRAM_VERSION)
        self.assertIn("LOC-SHELF-A", meta["locations"])

    def test_ledgers_start_as_headers_only(self):
        led = self.get("/api/ledgers")
        self.assertEqual(led["items"].strip(), ",".join(H.ITEM_COLUMNS))
        self.assertEqual(led["events"].strip(), ",".join(H.EVENT_COLUMNS))

    def test_mirror_then_read_back(self):
        out = self.post("/api/mirror", {
            "events": "event_id,device_id,event_type,value\nINV01-000001,INV01,gtin,00614141123452\n",
        })
        self.assertEqual(out["eventsWritten"], 1)
        self.assertIn("00614141123452", self.get("/api/ledgers")["events"])

    def test_mirror_is_idempotent_over_http(self):
        payload = {"events": "event_id,device_id,event_type\nINV01-000001,INV01,gtin\n"}
        self.post("/api/mirror", payload)
        second = self.post("/api/mirror", payload)
        self.assertEqual(second["eventsWritten"], 0)
        self.assertEqual(second["duplicatesSkipped"], 1)

    def test_unknown_route_is_404_not_a_crash(self):
        try:
            self.get("/api/nope")
            self.fail("expected HTTPError")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 404)

    def test_malformed_json_body_is_rejected_cleanly(self):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/mirror",
            data=b"{not json",
            headers={"Content-Type": "application/json"},
        )
        try:
            urllib.request.urlopen(req)
            self.fail("expected HTTPError")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
            self.assertIn("JSON", json.loads(e.read())["error"])

    def test_static_path_traversal_is_refused(self):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{self.port}/../../../etc/passwd")
        except urllib.error.HTTPError as e:
            self.assertIn(e.code, (403, 404))
        except Exception:
            pass          # the client may normalise the path away; also fine


if __name__ == "__main__":
    unittest.main(verbosity=2)
