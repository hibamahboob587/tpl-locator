from datetime import datetime, timezone
import logging
from typing import Dict, List, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.location import TrajectoryResponse, PlaybackResponse
logger = logging.getLogger(__name__)


def _to_naive_utc(dt: datetime) -> datetime:
    """
    Strip timezone from a datetime after converting to UTC.
    All stored timestamps are naive UTC, so queries must match that type.
    FastAPI parses ISO strings with 'Z' as timezone-aware — this normalizes them.
    """
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


class LocationService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.collection = db["locations"]

    async def get_trajectory(
        self,
        uid: str,
        sn: str,
        start_time: datetime,
        end_time: datetime,
    ) -> Optional[TrajectoryResponse]:
        logger.info("get_trajectory started sn=%s uid=%s", sn, uid)
        # Normalize to naive UTC to match stored timestamps
        start_time = _to_naive_utc(start_time)
        end_time   = _to_naive_utc(end_time)

        cursor = self.collection.find(
            {
                "sn": sn,
                "timestamp": {"$gte": start_time, "$lte": end_time},
            },
            {"lat": 1, "lng": 1, "timestamp": 1},
            sort=[("timestamp", 1)],
        )

        coords     = []
        timestamps = []
        async for doc in cursor:
            lat = doc.get("lat")
            lng = doc.get("lng")
            if lat is not None and lng is not None:
                coords.append([float(lng), float(lat)])  # GeoJSON: [lng, lat]
                ts = doc.get("timestamp")
                # Serialize timestamp to ISO string so the frontend can display it
                if isinstance(ts, datetime):
                    timestamps.append(ts.isoformat())
                elif ts is not None:
                    timestamps.append(str(ts))
                else:
                    timestamps.append(None)

        logger.info("get_trajectory completed sn=%s count=%s", sn, len(coords))

        if not coords:
            return None

        return TrajectoryResponse(
            feature={
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {
                    "device_sn":  sn,
                    "start":      start_time.isoformat(),
                    "end":        end_time.isoformat(),
                    # Per-point timestamps so the frontend popup can show time on hover
                    "timestamps": timestamps,
                },
            },
            count=len(coords),
            start_time=start_time,
            end_time=end_time,
            device_sn=sn,
        )

    async def get_playback_points(
        self,
        uid: str,
        sn: str,
        start_time: datetime,
        end_time: datetime,
    ) -> Optional[PlaybackResponse]:
        logger.info("get_playback_points started sn=%s uid=%s", sn, uid)
        # Normalize to naive UTC to match stored timestamps
        start_time = _to_naive_utc(start_time)
        end_time   = _to_naive_utc(end_time)

        cursor = self.collection.find(
            {
                "sn": sn,
                "timestamp": {"$gte": start_time, "$lte": end_time},
            },
            {"lat": 1, "lng": 1, "timestamp": 1, "speed": 1, "accuracy": 1},
            sort=[("timestamp", 1)],
        )

        points = []
        async for doc in cursor:
            lat = doc.get("lat")
            lng = doc.get("lng")
            if lat is not None and lng is not None:
                points.append({
                    "lat": float(lat),
                    "lng": float(lng),
                    "timestamp": doc["timestamp"],
                })

        logger.info("get_playback_points completed sn=%s count=%s", sn, len(points))

        if not points:
            return None

        duration = (end_time - start_time).total_seconds()

        return PlaybackResponse(
            points=points,
            count=len(points),
            start_time=start_time,
            end_time=end_time,
            device_sn=sn,
            duration_seconds=duration,
        )