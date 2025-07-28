from flask import Flask, jsonify, Response
import json
from flask_cors import CORS
import feedparser
import requests
from datetime import datetime, timedelta
import subprocess
import pandas as pd
from statsmodels.tsa.arima.model import ARIMA
import os
from bs4 import BeautifulSoup
from predict import predict_next_week
from parsing import (
    parse_moving_averages,
    parse_pivot_points,
    parse_technical_indicators,
    parse_historical_data,
    parse_investing_news,
    parse_google_news
)

app = Flask(__name__)
CORS(app)

# --- Constants ---
CURRENCY_TERMS = {
    "cny": "人民币 美元 OR 人民币 汇率",
    "jpy": "日元 美元 OR 日元 汇率",
    "twd": "新台币 美元 OR 新台币 汇率"
}


CURRENCY_PAIRS = {
    "jpy": "USDJPY=X",
    "twd": "USDTWD=X",
    "cny": "USDCNY=X",
    "cnh": "custom"  
}
# --- NEWS: /fetch-news/<currency> ---
@app.route("/fetch-news/<currency>", methods=["GET"])
def fetch_combined_news(currency):
    currency = currency.lower()
    if currency not in CURRENCY_TERMS:
        return jsonify({"error": "Unsupported currency"}), 400

    # Get Chinese news from Google
    chinese_news = []
    try:
        query = f'{CURRENCY_TERMS[currency]} when:1d'
        rss_url = f'https://news.google.com/rss/search?q={query.replace(" ", "+")}&hl=zh-CN&gl=CN&ceid=CN:zh'
        chinese_news = parse_google_news(feedparser.parse(rss_url))
    except Exception as e:
        print(f"Error fetching Google news: {e}")

    # Get English news from Investing.com
    english_news = []
    try:
        response = requests.get(
            f"https://www.investing.com/currencies/usd-{currency}-news",
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept-Language": "en-US,en;q=0.9"
            }
        )
        response.raise_for_status()
        english_news = parse_investing_news(response.text, currency)
    except Exception as e:
        print(f"Error fetching Investing.com news: {e}")

    # Combine and sort by time (newest first)
    combined_news = chinese_news + english_news
    combined_news.sort(key=lambda x: x.get('time', ''), reverse=True)

    return Response(
        json.dumps(combined_news, ensure_ascii=False),
        content_type='application/json; charset=utf-8'
    )

@app.route("/fetch-data/<currency>/<int:days>", methods=["GET"])
def fetch_forex(currency, days):
    currency = currency.lower()
    if currency not in CURRENCY_PAIRS:
        return jsonify({"error": "Unsupported currency"}), 400

    end_date = datetime.today()
    start_date = end_date - timedelta(days=days)
    currency_path = os.path.join("data", currency)
    os.makedirs(currency_path, exist_ok=True)
    data_path = os.path.join(currency_path, "data.json")

    try:
        if currency == "cnh":
            # 1. Scrape new CNH data
            response = requests.get(
                "https://www.investing.com/currencies/usd-cnh-historical-data",
                headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9"}
            )
            response.raise_for_status()
            new_data = parse_historical_data(response.text)

            # 2. Load historical data from testdata.json (NOT data.json)
            testdata_path = os.path.join("data", "cnh", "testdata.json")
            existing_data = []
            if os.path.exists(testdata_path):
                with open(testdata_path, "r") as f:
                    existing_data = json.load(f)

            # 3. Merge by date
            merged = {d["date"]: d for d in existing_data}
            for entry in new_data:
                merged[entry["date"]] = entry

            # 4. Filter to last <days> worth of entries
            final_data = [
                v for k, v in merged.items()
                if datetime.strptime(k, "%Y-%m-%d") >= start_date
            ]
            final_data.sort(key=lambda x: x["date"], reverse=True)


        else:
            symbol = CURRENCY_PAIRS[currency]
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range={days}d"
            headers = {
                "User-Agent": "Mozilla/5.0",
                "Accept-Language": "en-US,en;q=0.9"
            }
            resp = requests.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()

            result = data['chart']['result'][0]
            timestamps = result['timestamp']
            quotes = result['indicators']['quote'][0]

            final_data = []
            for i in range(len(timestamps)):
                if quotes['close'][i] is None:
                    continue
                final_data.append({
                    "date": datetime.utcfromtimestamp(timestamps[i]).strftime('%Y-%m-%d'),
                    "close": float(quotes['close'][i])
                })

            # Always keep only the latest N entries
            final_data = sorted(final_data, key=lambda x: x["date"], reverse=True)[:days]
            final_data.reverse()  # so oldest-to-newest

        # Save
        with open(data_path, "w", encoding="utf-8") as f:
            json.dump(final_data, f, indent=2, ensure_ascii=False)

        return jsonify({"success": "yay", "count": len(final_data)})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    
# --- TECH: /fetch-tech/<currency> ---
@app.route('/fetch-tech/<currency>', methods=['GET'])
def fetch_technical_data(currency):
    currency = currency.lower()
    if currency not in CURRENCY_PAIRS:
        return jsonify({"error": "Unsupported currency"}), 400

    try:
        response = requests.get(
            f"https://www.investing.com/currencies/usd-{currency}-technical",
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept-Language": "en-US,en;q=0.9"
            }
        )
        response.raise_for_status()
        html = response.text
        
        return jsonify({
            "currency": currency.upper(),
            "technical_indicators": parse_technical_indicators(html) or [],
            "moving_averages": parse_moving_averages(html) or [],
            "pivot_points": parse_pivot_points(html) or []
        })
    except Exception as e:
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

@app.route('/predict', methods=['GET'])
def run_predict():
    currencies = ['twd', 'jpy', 'cnh', 'cny']
    for cur in currencies:
        predict_next_week(cur)

    return jsonify({"success": "yay"})
# --- Helper Functions ---
def json_response(data, status=200):
    return Response(
        json.dumps(data, ensure_ascii=False),
        status=status,
        content_type='application/json; charset=utf-8'
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)