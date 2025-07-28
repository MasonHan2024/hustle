import pandas as pd
from statsmodels.tsa.arima.model import ARIMA
import os
import json
def predict_next_week(currency, horizon=7):
    # Load historical price data
    json_path = f"data/{currency}/data.json"
    output_path = f"data/{currency}/predictions.json"

    with open(json_path, 'r') as f:
        raw_data = json.load(f)

    df = pd.DataFrame(raw_data)
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date')
    df.set_index('date', inplace=True)
    df = df.asfreq('B')  # Mon–Fri only, fills missing with NaN
    
    # Drop any rows with missing close
    series = df['close']

    model = ARIMA(series, order=(1, 1, 2))
    model_fit = model.fit()

    # Forecast
    pred = model_fit.get_forecast(steps=horizon)
    mean = pred.predicted_mean
    ci = pred.conf_int()

    forecast = []
    last_date = df.index[-1]
    future_dates = pd.date_range(start=last_date + pd.offsets.BDay(1), periods=horizon, freq='B')

    for date, y, (low, high) in zip(future_dates, mean.values, ci.values):
        forecast.append({
            'date': date.strftime('%Y-%m-%d'),
            'mean': round(float(y), 6),
            'lower': round(float(low), 6),
            'upper': round(float(high), 6)
        })

    with open(output_path, 'w') as f:
        json.dump({'predictions': forecast}, f, indent=2)

    print(f"✅ {currency}: wrote forecast → {output_path}")
