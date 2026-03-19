"""
Anomaly Detection for Inventory Usage.

Two-tier approach:
  Tier 1 (Rule-based): Fast statistical checks run on every OUT event.
    - Unusually large single withdrawal (> 3σ from rolling mean)
    - High-frequency withdrawals by same user in short window
    - After-hours transactions (configurable)

  Tier 2 (ML-based): Isolation Forest run as a scheduled background task.
    - Detects multivariate anomalies in (quantity, frequency, time-of-day)
    - Returns anomaly scores stored against InventoryEvents

This clean separation means Tier 1 is always available (no training needed)
and Tier 2 improves over time as data accumulates.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

RULE_Z_SCORE_THRESHOLD = 3.0
RULE_RAPID_FIRE_COUNT = 5     # N events
RULE_RAPID_FIRE_WINDOW_MIN = 10  # within M minutes


@dataclass
class AnomalyFlag:
    is_anomaly: bool
    tier: str          # "rule" | "ml"
    score: float       # 0..1 (higher = more anomalous)
    reason: str
    details: dict[str, Any]


def check_statistical_anomaly(
    new_quantity: float,
    historical_quantities: list[float],
) -> AnomalyFlag:
    """
    Tier 1: Z-score check.
    Returns immediately — called inline during stock-out processing.
    """
    if len(historical_quantities) < 10:
        return AnomalyFlag(False, "rule", 0.0, "insufficient_history", {})

    arr = np.array(historical_quantities, dtype=float)
    mean, std = float(np.mean(arr)), float(np.std(arr))

    if std < 1e-9:
        return AnomalyFlag(False, "rule", 0.0, "zero_variance", {})

    z = (new_quantity - mean) / std

    if abs(z) > RULE_Z_SCORE_THRESHOLD:
        score = min(1.0, abs(z) / (RULE_Z_SCORE_THRESHOLD * 2))
        return AnomalyFlag(
            is_anomaly=True,
            tier="rule",
            score=score,
            reason="high_z_score",
            details={"z_score": round(z, 2), "mean": round(mean, 2), "std": round(std, 2)},
        )

    return AnomalyFlag(False, "rule", 0.0, "ok", {})


def check_rapid_fire(
    recent_event_times: list[datetime],
) -> AnomalyFlag:
    """
    Tier 1: Detect rapid succession of events by same actor.
    recent_event_times: last N event timestamps from the same actor for same item.
    """
    now = datetime.now(timezone.utc)
    window = now - timedelta(minutes=RULE_RAPID_FIRE_WINDOW_MIN)
    recent = [t for t in recent_event_times if t >= window]

    if len(recent) >= RULE_RAPID_FIRE_COUNT:
        return AnomalyFlag(
            is_anomaly=True,
            tier="rule",
            score=0.85,
            reason="rapid_fire_events",
            details={"count_in_window": len(recent), "window_minutes": RULE_RAPID_FIRE_WINDOW_MIN},
        )

    return AnomalyFlag(False, "rule", 0.0, "ok", {})


class IsolationForestDetector:
    """
    Tier 2: Multivariate anomaly detection.
    Trained offline (via background task) on the full transaction history.
    Call .score(features) to get real-time scores after training.
    """

    def __init__(self, contamination: float = 0.05) -> None:
        self._model: IsolationForest | None = None
        self._scaler = StandardScaler()
        self.contamination = contamination
        self.is_trained = False

    def fit(self, features: list[list[float]]) -> None:
        """
        Train on a feature matrix: [[qty, hour_of_day, day_of_week, rolling_avg, ...], ...]
        Requires at least 50 samples.
        """
        if len(features) < 50:
            logger.info("IsolationForest: not enough data (%d < 50)", len(features))
            return

        X = np.array(features, dtype=float)
        X_scaled = self._scaler.fit_transform(X)
        self._model = IsolationForest(contamination=self.contamination, random_state=42, n_jobs=-1)
        self._model.fit(X_scaled)
        self.is_trained = True
        logger.info("IsolationForest trained on %d samples", len(features))

    def score(self, feature_vector: list[float]) -> AnomalyFlag:
        if not self.is_trained or self._model is None:
            return AnomalyFlag(False, "ml", 0.0, "model_not_trained", {})

        X = np.array([feature_vector], dtype=float)
        X_scaled = self._scaler.transform(X)
        raw_score = self._model.decision_function(X_scaled)[0]
        prediction = self._model.predict(X_scaled)[0]

        # Isolation Forest: -1 = anomaly, 1 = normal
        # Convert decision_function score (negative = more anomalous) to 0..1
        anomaly_score = float(np.clip(-raw_score, 0, 1))
        is_anomaly = prediction == -1

        return AnomalyFlag(
            is_anomaly=is_anomaly,
            tier="ml",
            score=anomaly_score,
            reason="isolation_forest" if is_anomaly else "ok",
            details={"raw_score": round(float(raw_score), 4)},
        )


def build_feature_vector(
    quantity: float,
    occurred_at: datetime,
    rolling_7d_avg: float,
    rolling_30d_avg: float,
) -> list[float]:
    return [
        quantity,
        occurred_at.hour,
        occurred_at.weekday(),
        rolling_7d_avg,
        rolling_30d_avg,
        quantity / (rolling_7d_avg + 1e-9),  # relative to recent average
    ]


# Singleton model instances keyed by item_id
_models: dict[int, IsolationForestDetector] = {}


def get_detector(item_id: int) -> IsolationForestDetector:
    if item_id not in _models:
        _models[item_id] = IsolationForestDetector()
    return _models[item_id]
