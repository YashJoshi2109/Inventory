# Lab Inventory Control System

A Flask-based web application for managing laboratory inventory with barcode/RFID support. Track stock levels, log transactions, monitor reorder alerts, and manage SKUs — all backed by an Excel spreadsheet.

![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/Flask-3.x-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **Dashboard UI** — Real-time inventory overview with KPI cards, charts, and status indicators
- **Stock Tracking** — Log stock IN (receive) and OUT (use) transactions
- **Reorder Alerts** — Automatically flags items at or below reorder level
- **Barcode / RFID Lookup** — Look up items by SKU or RFID tag
- **Multi-Location Support** — Track inventory across up to 3 bin locations
- **Excel Backend** — All data stored in `Lab_Inventory_Barcode_System.xlsx` with formatted sheets
- **REST API** — Full JSON API for programmatic access
- **CLI Interface** — Command-line tools for quick inventory operations

## Project Structure

```
├── app.py                              # Flask web server & REST API
├── inventory_manager.py                # Core inventory logic & Excel I/O
├── dashboard.html                      # Single-page dashboard UI
├── Lab_Inventory_Barcode_System.xlsx   # Data file (Excel workbook)
└── README.md
```

### Excel Workbook Sheets

| Sheet               | Purpose                                      |
|----------------------|----------------------------------------------|
| `Items_Master`       | SKU registry (SKU, description, category, cost, reorder level, bin locations, barcode) |
| `Transactions`       | Every IN/OUT log with date, type, SKU, quantity, location, and notes |
| `Inventory_Summary`  | Auto-calculated on-hand quantities (SUMIFS)   |
| `SKU_Finder`         | Single-SKU lookup                            |
| `Graph`              | Chart data feed                              |
| `Labels_5161`        | Avery 5161 label sheet                       |
| `Dashboard`          | KPI summary                                  |

## Getting Started

### Prerequisites

- Python 3.10 or higher

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YashJoshi2109/Inventory.git
   cd Inventory
   ```

2. **Create a virtual environment**
   ```bash
   python3 -m venv venv
   source venv/bin/activate        # macOS / Linux
   # venv\Scripts\activate         # Windows
   ```

3. **Install dependencies**
   ```bash
   pip install flask pandas openpyxl
   ```

4. **Run the server**
   ```bash
   python app.py
   ```
   The app starts at **http://localhost:5000**. To use a different port:
   ```bash
   python app.py 5001
   ```

5. **Open the dashboard**

   Navigate to [http://localhost:5000](http://localhost:5000) in your browser.

## REST API Reference

### Read Endpoints

| Method | Endpoint                     | Description                              |
|--------|------------------------------|------------------------------------------|
| `GET`  | `/`                          | Serve the dashboard UI                   |
| `GET`  | `/api/inventory`             | All items with computed on-hand quantity  |
| `GET`  | `/api/inventory/<sku>`       | Single item by SKU                       |
| `GET`  | `/api/inventory/rfid/<tag>`  | Lookup item by RFID tag / barcode        |
| `GET`  | `/api/reorder`               | Items at or below reorder level          |
| `GET`  | `/api/stats`                 | KPI summary (totals, categories, status) |
| `GET`  | `/api/log`                   | Full transaction log                     |

#### Query Parameters

- `/api/inventory?category=Reagents` — Filter by category
- `/api/inventory?status=LOW` — Filter by stock status
- `/api/inventory?low_stock=true` — Show only low-stock items
- `/api/log?type=IN` or `/api/log?type=OUT` — Filter transactions by type

### Write Endpoints

| Method | Endpoint          | Body                                    | Description       |
|--------|-------------------|-----------------------------------------|--------------------|
| `POST` | `/api/receive`    | `{ "sku", "qty", "loc?", "notes?" }`   | Log stock IN       |
| `POST` | `/api/use`        | `{ "sku", "qty", "loc?", "notes?" }`   | Log stock OUT      |
| `POST` | `/api/add-item`   | `{ "sku", "name", "category?", "cost?", "price?", "reorder?", "lead?", "loc1_bin?", "loc2_bin?", "loc3_bin?" }` | Add a new SKU |

### Example API Calls

```bash
# Get all inventory
curl http://localhost:5000/api/inventory

# Receive 500 units of LAB-001
curl -X POST http://localhost:5000/api/receive \
  -H "Content-Type: application/json" \
  -d '{"sku": "LAB-001", "qty": 500, "notes": "Restocked"}'

# Use 2 units of LAB-002
curl -X POST http://localhost:5000/api/use \
  -H "Content-Type: application/json" \
  -d '{"sku": "LAB-002", "qty": 2, "loc": 1, "notes": "EXP-2026-005"}'

# Add a new item
curl -X POST http://localhost:5000/api/add-item \
  -H "Content-Type: application/json" \
  -d '{"sku": "LAB-016", "name": "Trypan Blue", "category": "Reagents", "cost": 18.50, "reorder": 3}'
```

## CLI Usage

The `inventory_manager.py` module can also be used directly from the command line:

```bash
# Query all inventory
python inventory_manager.py query

# Query a specific SKU
python inventory_manager.py query --sku LAB-001

# Filter by category and low-stock
python inventory_manager.py query --category Reagents --low-stock

# Receive stock
python inventory_manager.py receive --sku LAB-001 --qty 500 --notes "Restocked"

# Use stock
python inventory_manager.py use --sku LAB-002 --qty 2 --loc 1 --notes "EXP-2026-005"

# Add a new item
python inventory_manager.py add-item --sku LAB-016 --name "Trypan Blue" \
  --category Reagents --cost 18.50 --reorder 3

# Check reorder alerts
python inventory_manager.py reorder

# RFID tag lookup
python inventory_manager.py rfid --tag RFID-0003

# Sync/recalculate summaries
python inventory_manager.py sync
```

## Tech Stack

- **Backend** — [Flask](https://flask.palletsprojects.com/) (Python)
- **Data Layer** — [pandas](https://pandas.pydata.org/) + [openpyxl](https://openpyxl.readthedocs.io/) (Excel read/write)
- **Frontend** — Vanilla HTML/CSS/JS (single-page dashboard)
- **Storage** — Excel workbook (`Lab_Inventory_Barcode_System.xlsx`)
