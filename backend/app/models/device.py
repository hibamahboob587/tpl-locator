from datetime import datetime
from typing import Optional

from bson import ObjectId
from pydantic import BaseModel, Field

from app.models.admin import PyObjectId


class DeviceInDB(BaseModel):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    sn: str
    admin_id: Optional[PyObjectId] = None  # Optional to support legacy/test docs without admin_id
    user_id: Optional[PyObjectId] = None
    name: Optional[str] = ""
    client: Optional[str] = None
    region: Optional[str] = None
    bound_at: Optional[datetime] = None    # stamped when device is assigned to a user
    created_at: datetime = Field(default_factory=datetime.utcnow)
    location: Optional[str] = None         # sub-region / location label (admin-defined)
    zone: Optional[str] = None             # zone label within a location (admin-defined)

    class Config:
        json_encoders = {ObjectId: str}
        populate_by_name = True
        arbitrary_types_allowed = True


class DeviceCreate(BaseModel):
    sn: str
    admin_id: str
    user_id: Optional[str] = None
    name: Optional[str] = None


class DevicePublic(BaseModel):
    id: str
    sn: str
    name: Optional[str]
    user_id: Optional[str]
    admin_id: str