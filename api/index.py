"""
Vercel Serverless Entry Point
==============================
Wraps the Flask app for Vercel's Python runtime.
All routes are handled by Flask via the catch-all rewrite in vercel.json.

NOTE: Vercel serverless functions have a READ-ONLY filesystem.
      - GET endpoints (inventory, stats, reorder, log) work normally.
      - POST endpoints (receive, use, add-item) will return an error
        because the Excel file cannot be written to on Vercel.
"""

import sys
from pathlib import Path

# Make the project root importable
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import app
