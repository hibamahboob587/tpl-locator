from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from pydantic import BaseModel, EmailStr, Field
from pydantic_core import core_schema


class PyObjectId(ObjectId):
    """
    Pydantic v2-compatible ObjectId type.
    """

    @classmethod
    def __get_pydantic_core_schema__(cls, source_type, handler):
        return core_schema.no_info_plain_validator_function(cls._validate)

    @classmethod
    def _validate(cls, v):
        if isinstance(v, ObjectId):
            return v
        if isinstance(v, str):
            try:
                return ObjectId(v)
            except Exception as exc:  # pragma: no cover - defensive
                raise ValueError("Invalid ObjectId") from exc
        raise TypeError("ObjectId required")


class AdminInDB(BaseModel):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    email: EmailStr
    password: str
    uid: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    reg_devices: List[str] = Field(default_factory=list)  # new field

    # Optional cached CityTag token
    citytag_token: Optional[str] = None

    class Config:
        json_encoders = {ObjectId: str}
        populate_by_name = True
        arbitrary_types_allowed = True


class AdminCreate(BaseModel):
    email: EmailStr
    password: str
    uid: str


class AdminPublic(BaseModel):
    id: str
    email: EmailStr
    uid: str
    created_at: datetime
    reg_device: str
    reg_devices: List[str]