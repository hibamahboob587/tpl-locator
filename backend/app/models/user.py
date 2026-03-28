from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from pydantic import BaseModel, EmailStr, Field

from app.models.admin import PyObjectId


class UserInDB(BaseModel):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    email: EmailStr
    password: str
    name: Optional[str] = ""
    role: str = "user"  # could be 'user' or 'admin' (for flexibility)
    admin_id: Optional[PyObjectId] = None
    devices: List[PyObjectId] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        json_encoders = {ObjectId: str}
        populate_by_name = True
        arbitrary_types_allowed = True


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    name: Optional[str] = None
    admin_id: Optional[str] = None
    devices: List[str] = []
