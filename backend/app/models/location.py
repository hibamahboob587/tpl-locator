from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ────────────────────────────────────────────────
#               API Response Models
# ────────────────────────────────────────────────

class TrajectoryGeometry(BaseModel):
    type: str = "LineString"
    coordinates: List[List[float]]  # [[lng, lat], [lng, lat], ...]


class TrajectoryFeature(BaseModel):
    type: str = "Feature"
    geometry: TrajectoryGeometry
    properties: dict = Field(default_factory=dict)


class TrajectoryResponse(BaseModel):
    """GeoJSON-compatible response for drawing route line"""
    feature: TrajectoryFeature
    count: int
    start_time: datetime
    end_time: datetime
    device_sn: str

    model_config = ConfigDict(
        json_encoders={datetime: lambda v: v.isoformat()},
    )


class PlaybackPoint(BaseModel):
    lat: float
    lng: float
    timestamp: datetime


class PlaybackResponse(BaseModel):
    """Time-ordered points for animation/playback"""
    points: List[PlaybackPoint]
    count: int
    start_time: datetime
    end_time: datetime
    device_sn: str
    duration_seconds: Optional[float] = None

    model_config = ConfigDict(
        json_encoders={datetime: lambda v: v.isoformat()},
    )