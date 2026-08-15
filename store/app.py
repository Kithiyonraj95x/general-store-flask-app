"""
General Store — backend API

Run with:  python app.py
Then open: http://localhost:5000

Stores today's items and sales in a local SQLite file (store.db).
Each day starts fresh automatically because everything is scoped by date.
"""

import json
import os
import sqlite3
from datetime import date, datetime

from flask import Flask, jsonify, request, send_from_directory

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "store.db")
FRONTEND_DIR = os.path.join(APP_DIR, "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            unit_type TEXT NOT NULL,     -- 'piece' or 'weight'
            price REAL NOT NULL,         -- rupees per piece, or rupees per kg
            date TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            total REAL NOT NULL,
            lines_json TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def today_str():
    return date.today().isoformat()


# ---------- frontend ----------

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "app.html")

# ---------- items (today's shelf) ----------

@app.route("/api/items", methods=["GET"])
def list_items():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM items WHERE date = ? ORDER BY id", (today_str(),)
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/items", methods=["POST"])
def add_item():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    unit_type = data.get("unit_type")
    price = data.get("price")

    if not name:
        return jsonify({"error": "name is required"}), 400
    if unit_type not in ("piece", "weight"):
        return jsonify({"error": "unit_type must be 'piece' or 'weight'"}), 400
    try:
        price = float(price)
        if price < 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "price must be a positive number"}), 400

    conn = get_db()
    cur = conn.execute(
        "INSERT INTO items (name, unit_type, price, date) VALUES (?, ?, ?, ?)",
        (name, unit_type, price, today_str()),
    )
    conn.commit()
    item_id = cur.lastrowid
    conn.close()
    return (
        jsonify(
            {
                "id": item_id,
                "name": name,
                "unit_type": unit_type,
                "price": price,
                "date": today_str(),
            }
        ),
        201,
    )


@app.route("/api/items/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    conn = get_db()
    conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return jsonify({"deleted": item_id})


# ---------- sales ----------

@app.route("/api/sales/today", methods=["GET"])
def sales_today():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM sales WHERE date = ? ORDER BY id", (today_str(),)
    ).fetchall()
    conn.close()
    sales = []
    for r in rows:
        s = dict(r)
        s["lines"] = json.loads(s.pop("lines_json"))
        sales.append(s)
    total = sum(s["total"] for s in sales)
    return jsonify({"sales": sales, "total": total, "count": len(sales)})


@app.route("/api/sales", methods=["POST"])
def create_sale():
    data = request.get_json(force=True) or {}
    lines = data.get("lines") or []
    if not lines:
        return jsonify({"error": "no items in sale"}), 400

    total = 0.0
    for line in lines:
        try:
            total += float(line["price"])
        except (KeyError, TypeError, ValueError):
            return jsonify({"error": "invalid line item"}), 400

    conn = get_db()
    cur = conn.execute(
        "INSERT INTO sales (date, time, total, lines_json) VALUES (?, ?, ?, ?)",
        (today_str(), datetime.now().strftime("%I:%M %p"), total, json.dumps(lines)),
    )
    conn.commit()
    sale_id = cur.lastrowid
    conn.close()
    return jsonify({"id": sale_id, "total": total}), 201


@app.route("/api/sales/adjustment", methods=["POST"])
def add_adjustment():
    """Manually nudge today's total up or down. Recorded as a normal
    sale entry (unit_type 'adjustment') so the running total and sale
    count stay consistent and the change is visible in history."""
    data = request.get_json(force=True) or {}
    note = (data.get("note") or "Manual adjustment").strip()
    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "amount must be a number"}), 400
    if amount == 0:
        return jsonify({"error": "amount cannot be zero"}), 400

    lines = [{"name": note, "unit_type": "adjustment", "price": amount}]
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO sales (date, time, total, lines_json) VALUES (?, ?, ?, ?)",
        (today_str(), datetime.now().strftime("%I:%M %p"), amount, json.dumps(lines)),
    )
    conn.commit()
    sale_id = cur.lastrowid
    conn.close()
    return jsonify({"id": sale_id, "total": amount}), 201


@app.route("/api/sales/today", methods=["DELETE"])
def reset_today():
    """Reset today's sales total back to ₹0.00 by clearing all of
    today's sale records. Does not touch the shelf/items."""
    conn = get_db()
    conn.execute("DELETE FROM sales WHERE date = ?", (today_str(),))
    conn.commit()
    conn.close()
    return jsonify({"reset": True})


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
