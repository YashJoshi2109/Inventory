"""
Lab Inventory Control System — Flask Web Server
================================================
Serves dashboard.html and exposes REST API backed by
Lab_Inventory_Barcode_System.xlsx (exact template structure).

Run:
    pip install flask pandas openpyxl
    python app.py
    # Open http://localhost:5000

API:
    GET  /                              Dashboard UI
    GET  /api/inventory                 All items with on-hand (SUMIFS recomputed)
    GET  /api/inventory/<sku>           Single item
    GET  /api/inventory/rfid/<tag>      Lookup by RFID tag (tag = SKU barcode)
    GET  /api/reorder                   Items at/below reorder level
    GET  /api/stats                     KPI summary
    GET  /api/log                       Full transaction log
    POST /api/receive                   Log stock IN  {sku, qty, loc, notes}
    POST /api/use                       Log stock OUT {sku, qty, loc, notes}
    POST /api/add-item                  Add new SKU   {sku, name, category, ...}
"""

from flask import Flask, jsonify, request, send_file, Response
import pandas as pd
import sys, json, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import inventory_manager as im

app       = Flask(__name__)
_ROOT     = Path(__file__).resolve().parent
DB_PATH   = _ROOT / "Lab_Inventory_Barcode_System.xlsx"
DASH_PATH = _ROOT / "dashboard.html"


def cors(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

def to_json(obj):
    return json.dumps(obj, default=str)


@app.route("/")
def dashboard():
    if DASH_PATH.exists():
        return Response(DASH_PATH.read_text(encoding="utf-8"),
                        mimetype="text/html")
    return "<h1>Place dashboard.html in the same folder as app.py</h1>", 404


@app.route("/api/inventory", methods=["GET"])
def get_inventory():
    items = im.read_items()
    txns  = im.read_transactions()
    df    = im.compute_on_hand(items, txns)

    if request.args.get("category"):
        df = df[df["category"].str.lower() == request.args["category"].lower()]
    if request.args.get("status"):
        df = df[df["status"].str.upper() == request.args["status"].upper()]
    if request.args.get("low_stock"):
        df = df[df["on_hand"] <= df["reorder_level"]]

    records = df.fillna("").to_dict(orient="records")
    return cors(Response(to_json({"count": len(records), "items": records}),
                         mimetype="application/json"))


@app.route("/api/inventory/<sku>", methods=["GET"])
def get_item(sku):
    items = im.read_items()
    txns  = im.read_transactions()
    df    = im.compute_on_hand(items, txns)
    row   = df[df["sku"].str.upper() == sku.upper()]
    if row.empty:
        return jsonify({"error": f"SKU '{sku}' not found"}), 404
    return cors(Response(to_json(row.fillna("").to_dict(orient="records")[0]),
                         mimetype="application/json"))


@app.route("/api/inventory/rfid/<tag>", methods=["GET"])
def rfid_lookup(tag):
    # RFID tag IS the SKU barcode text (col L of Items_Master)
    items = im.read_items()
    txns  = im.read_transactions()
    df    = im.compute_on_hand(items, txns)
    row   = df[df["barcode"].astype(str).str.upper() == tag.upper()]
    if row.empty:
        # Fallback: treat tag as SKU directly
        row = df[df["sku"].str.upper() == tag.upper()]
    if row.empty:
        return jsonify({"error": f"Tag '{tag}' not found"}), 404
    return cors(Response(to_json(row.fillna("").to_dict(orient="records")[0]),
                         mimetype="application/json"))


@app.route("/api/reorder", methods=["GET"])
def get_reorder():
    items = im.read_items()
    txns  = im.read_transactions()
    df    = im.compute_on_hand(items, txns)
    low   = df[df["on_hand"] <= df["reorder_level"]]
    return cors(Response(to_json({"count": len(low),
                                   "items": low.fillna("").to_dict(orient="records")}),
                         mimetype="application/json"))


@app.route("/api/stats", methods=["GET"])
def get_stats():
    items = im.read_items()
    txns  = im.read_transactions()
    df    = im.compute_on_hand(items, txns)
    return cors(jsonify({
        "total_skus":          len(df),
        "total_transactions":  len(txns),
        "items_ok":            int((df["status"] == "OK").sum()),
        "items_low":           int((df["status"] == "LOW").sum()),
        "total_cost_value":    round(float((df["on_hand"] * df["unit_cost"]).sum()), 2),
        "categories":          df["category"].value_counts().to_dict(),
        "status_breakdown":    df["status"].value_counts().to_dict(),
    }))


@app.route("/api/log", methods=["GET"])
def get_log():
    txns = im.read_transactions()
    type_filter = request.args.get("type", "").upper()
    if type_filter in ("IN", "OUT"):
        txns = txns[txns["type"].str.upper() == type_filter]
    return cors(Response(to_json({"count": len(txns),
                                   "transactions": txns.fillna("").to_dict(orient="records")}),
                         mimetype="application/json"))


@app.route("/api/receive", methods=["POST", "OPTIONS"])
def api_receive():
    if request.method == "OPTIONS": return cors(jsonify({}))
    data = request.get_json() or {}
    if "sku" not in data or "qty" not in data:
        return jsonify({"error": "sku and qty required"}), 400
    try:
        class A: pass
        args = A()
        args.sku   = data["sku"]
        args.qty   = float(data["qty"])
        args.loc   = int(data.get("loc", 1))
        args.notes = data.get("notes", "API receive")
        im.receive(args)
        return cors(jsonify({"success": True}))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/use", methods=["POST", "OPTIONS"])
def api_use():
    if request.method == "OPTIONS": return cors(jsonify({}))
    data = request.get_json() or {}
    if "sku" not in data or "qty" not in data:
        return jsonify({"error": "sku and qty required"}), 400
    try:
        class A: pass
        args = A()
        args.sku   = data["sku"]
        args.qty   = float(data["qty"])
        args.loc   = int(data.get("loc", 1))
        args.notes = data.get("notes", "API use")
        im.use(args)
        return cors(jsonify({"success": True}))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/add-item", methods=["POST", "OPTIONS"])
def api_add_item():
    if request.method == "OPTIONS": return cors(jsonify({}))
    data = request.get_json() or {}
    if "sku" not in data or "name" not in data:
        return jsonify({"error": "sku and name required"}), 400
    try:
        class A: pass
        args = A()
        args.sku      = data["sku"]
        args.name     = data["name"]
        args.category = data.get("category", "Other")
        args.cost     = float(data.get("cost", 0))
        args.price    = float(data.get("price", 0))
        args.reorder  = float(data.get("reorder", 10))
        args.lead     = int(data.get("lead", 7))
        args.loc1_bin = data.get("loc1_bin", "")
        args.loc2_bin = data.get("loc2_bin", "")
        args.loc3_bin = data.get("loc3_bin", "")
        im.add_item(args)
        return cors(jsonify({"success": True}))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    import sys
    port = 5000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    if not DB_PATH.exists():
        print(f"WARNING: {DB_PATH} not found.")
    else:
        print(f"Database: {DB_PATH}")
    print(f"Starting at http://localhost:{port}")
    app.run(debug=True, host="0.0.0.0", port=port)
