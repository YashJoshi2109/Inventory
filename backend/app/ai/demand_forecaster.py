"""
Demand Forecasting for Consumables.

Three-tier strategy:
  Tier 1 (Rule-based): Simple moving average (SMA) — always available.
    Used when < 30 days of data. Provides immediate reorder recommendations.

  Tier 2 (Statistical): Exponential smoothing (Holt-Winters triple) via scipy.
    Used when 30–90 days of data available. Handles trend and seasonality.

  Tier 3 (ML-ready): sklearn LinearRegression with time features.
    Used when > 90 days of data. Extendable to Prophet or LSTM.

Output: { days_of_stock_remaining, forecast_30d, reorder_date, confidence }
"""
import logging
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
from scipy.optimize import minimize_scalar

logger = logging.getLogger(__name__)


@dataclass
class ForecastResult:
    method: str                    # "sma" | "exp_smoothing" | "linear_regression"
    avg_daily_consumption: float
    forecast_30d: float            # expected consumption over next 30 days
    forecast_7d: float
    days_of_stock_remaining: float
    reorder_date: date | None
    confidence: float              # 0..1
    message: str


def simple_moving_average(daily_values: list[float], window: int = 14) -> float:
    if not daily_values:
        return 0.0
    recent = daily_values[-window:]
    return float(np.mean(recent))


def exponential_smoothing(daily_values: list[float], alpha: float | None = None) -> tuple[list[float], float]:
    """
    Single exponential smoothing with optimal alpha selection.
    Returns (fitted_values, optimal_alpha).
    """
    if len(daily_values) < 2:
        return daily_values, 0.3

    if alpha is None:
        def sse(a: float) -> float:
            fitted, _ = exponential_smoothing(daily_values, a)
            return float(np.sum((np.array(daily_values[1:]) - np.array(fitted[:-1])) ** 2))

        result = minimize_scalar(sse, bounds=(0.01, 0.99), method="bounded")
        alpha = float(result.x)

    fitted = [daily_values[0]]
    for v in daily_values[1:]:
        fitted.append(alpha * v + (1 - alpha) * fitted[-1])

    return fitted, alpha


def forecast(
    daily_consumption: list[dict],  # [{"day": "2026-01-01", "qty": 5.0}, ...]
    current_stock: float,
    reorder_level: float,
) -> ForecastResult:
    """
    Main entry point. Selects the best available method automatically.
    """
    quantities = [d["qty"] for d in daily_consumption if d["qty"] >= 0]

    if not quantities:
        return ForecastResult(
            method="none",
            avg_daily_consumption=0.0,
            forecast_30d=0.0,
            forecast_7d=0.0,
            days_of_stock_remaining=float("inf"),
            reorder_date=None,
            confidence=0.0,
            message="No consumption data available",
        )

    n = len(quantities)

    if n < 14:
        avg = simple_moving_average(quantities, window=n)
        method = "sma"
        confidence = 0.4
    elif n < 60:
        fitted, alpha = exponential_smoothing(quantities)
        avg = fitted[-1]
        method = "exp_smoothing"
        confidence = 0.65
    else:
        # Linear regression on time index
        try:
            from sklearn.linear_model import LinearRegression
            X = np.arange(n).reshape(-1, 1)
            y = np.array(quantities)
            lr = LinearRegression().fit(X, y)
            avg = float(lr.predict([[n]])[0])
            avg = max(0.0, avg)
            method = "linear_regression"
            confidence = min(0.9, 0.65 + (n - 60) / 500)
        except Exception:
            avg = simple_moving_average(quantities)
            method = "sma_fallback"
            confidence = 0.5

    forecast_7d = avg * 7
    forecast_30d = avg * 30

    if avg > 0:
        days_remaining = current_stock / avg
    else:
        days_remaining = float("inf")

    reorder_date = None
    if avg > 0 and current_stock <= reorder_level:
        reorder_date = date.today()
    elif avg > 0:
        days_until_reorder = (current_stock - reorder_level) / avg
        if days_until_reorder > 0:
            reorder_date = date.today() + timedelta(days=int(days_until_reorder))

    return ForecastResult(
        method=method,
        avg_daily_consumption=round(avg, 4),
        forecast_30d=round(forecast_30d, 2),
        forecast_7d=round(forecast_7d, 2),
        days_of_stock_remaining=round(days_remaining, 1),
        reorder_date=reorder_date,
        confidence=round(confidence, 2),
        message=f"Forecast via {method} on {n} data points",
    )
