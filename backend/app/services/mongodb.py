from typing import Optional, List
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from bson import ObjectId

from app.auth_utils import hash_password
from app.models.admin import AdminInDB, AdminCreate
from app.models.device import DeviceInDB



import os

# choose database name via environment, default to development db
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "citytag_development")
ADMINS_COLLECTION = "admins"


class MongoService:
    def __init__(self, uri: str):
        self._client = AsyncIOMotorClient(uri)

    @property
    def client(self) -> AsyncIOMotorClient:
        return self._client

    @property
    def db(self) -> AsyncIOMotorDatabase:
        return self._client[MONGO_DB_NAME]

    @property
    def admins(self):
        return self.db[ADMINS_COLLECTION]

    @property
    def users(self):
        return self.db["users"]

    @property
    def devices(self):
        return self.db["devices"]

    @property
    def locations(self):
        return self.db["locations"]

    async def get_admin_by_email(self, email: str) -> Optional[AdminInDB]:
        doc = await self.admins.find_one({"email": email})
        if not doc:
            return None
        return AdminInDB(**doc)

    # ---------- user methods ----------
    async def get_user_by_email(self, email: str):
        doc = await self.users.find_one({"email": email})
        if not doc:
            return None
        from app.models.user import UserInDB
        return UserInDB(**doc)

    async def get_user_by_id(self, user_id: str):
        try:
            oid = ObjectId(user_id)
        except Exception:
            return None
        doc = await self.users.find_one({"_id": oid})
        if not doc:
            return None
        from app.models.user import UserInDB
        return UserInDB(**doc)

    async def create_user(self, email: str, password: str, name: Optional[str] = None) -> 'UserInDB':
        from app.models.user import UserInDB
        payload = {
            "email": email,
            "password": hash_password(password),
            "name": name or "",
            "role": "user",
            "admin_id": None,
            "devices": [],
            "created_at": datetime.now(timezone.utc),
        }
        result = await self.users.insert_one(payload)
        created = await self.users.find_one({"_id": result.inserted_id})
        return UserInDB(**created)

    async def update_user_admin(self, user_id: str, admin_id: str):
        await self.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"admin_id": ObjectId(admin_id)}})

    async def delete_user(self, user_id: str) -> bool:
        """Unassign all devices from this user, then delete the user. Returns True if deleted."""
        try:
            oid = ObjectId(user_id)
        except Exception:
            return False
        await self.devices.update_many({"user_id": oid}, {"$set": {"user_id": None, "bound_at": None}})
        result = await self.users.delete_one({"_id": oid})
        return result.deleted_count == 1

    # ---------- device methods ----------
    async def count_devices_by_admin(self, admin_id: str) -> int:
        """Return the number of devices owned by this admin."""
        try:
            oid = ObjectId(admin_id)
        except Exception:
            return 0
        return await self.devices.count_documents({"admin_id": oid})

    async def create_device(self, sn: str, admin_id: str, name: Optional[str] = None):
        payload = {"sn": sn, "admin_id": ObjectId(admin_id), "name": name or ""}
        result = await self.devices.insert_one(payload)
        doc = await self.devices.find_one({"_id": result.inserted_id})
        return DeviceInDB(**doc)

    async def get_device_by_sn(self, sn: str):
        doc = await self.devices.find_one({"sn": sn})
        if not doc:
            return None
        return DeviceInDB(**doc)

    async def assign_device_to_user(self, sn: str, user_id: str):
        device_doc = await self.devices.find_one({"sn": sn})
        if not device_doc:
            return None
        if device_doc.get("user_id"):
            return None  # already assigned
        await self.devices.update_one(
            {"sn": sn},
            {"$set": {"user_id": ObjectId(user_id), "bound_at": datetime.now(timezone.utc)}},
        )
        await self.users.update_one({"_id": ObjectId(user_id)}, {"$push": {"devices": device_doc["_id"]}})
        updated = await self.devices.find_one({"sn": sn})
        return DeviceInDB(**updated)

    async def unassign_device(self, sn: str):
        device_doc = await self.devices.find_one({"sn": sn})
        if not device_doc or not device_doc.get("user_id"):
            return None
        user_id = device_doc["user_id"]
        await self.devices.update_one({"sn": sn}, {"$set": {"user_id": None, "bound_at": None}})
        await self.users.update_one({"_id": user_id}, {"$pull": {"devices": device_doc["_id"]}})
        return True

    async def get_admin_by_id(self, admin_id: str) -> Optional[AdminInDB]:
        try:
            oid = ObjectId(admin_id)
        except Exception:
            return None
        doc = await self.admins.find_one({"_id": oid})
        if not doc:
            return None
        return AdminInDB(**doc)

    async def create_or_update_admin(
        self,
        data: AdminCreate,
        citytag_token: Optional[str] = None,
        reg_devices: Optional[List[str]] = None,
    ) -> AdminInDB:
        existing = await self.get_admin_by_email(data.email)
        payload = {
            "email": data.email,
            "password": hash_password(data.password),
            "uid": data.uid,
        }
        if citytag_token is not None:
            payload["citytag_token"] = citytag_token
        if reg_devices is not None:
            payload["reg_devices"] = reg_devices

        if existing:
            await self.admins.update_one(
                {"_id": existing.id},
                {"$set": payload},
            )
            updated = await self.admins.find_one({"_id": existing.id})
            return AdminInDB(**updated)

        result = await self.admins.insert_one(payload)
        created = await self.admins.find_one({"_id": result.inserted_id})
        return AdminInDB(**created)

    async def update_admin_token(self, admin_id: str, token: str) -> None:
        await self.admins.update_one(
            {"_id": ObjectId(admin_id)},
            {"$set": {"citytag_token": token}},
        )

    async def upsert_location_from_citytag(
        self,
        history_item: dict,
        uid: str,
        sn: Optional[str] = None,
    ) -> bool:
        ts_raw = history_item.get("gpstime") or history_item.get("time") or history_item.get("timestamp")
        timestamp = self._parse_citytag_timestamp(ts_raw)
        # Adjust incoming timestamp by subtracting 3 hours before persisting
        if timestamp is not None:
            timestamp = timestamp - timedelta(hours=3)

        doc = {
            "uid": uid,
            "sn": sn or history_item.get("sn"),
            "timestamp": timestamp,
            "lat": float(history_item.get("lat") or history_item.get("latitude") or 0),
            "lng": float(history_item.get("lng") or history_item.get("lon") or history_item.get("longitude") or 0),
        }

        if doc["lat"] == 0 or doc["lng"] == 0 or not doc["sn"]:
            return False

        query = {
            "uid": doc["uid"],
            "sn": doc["sn"],
            "timestamp": doc["timestamp"],
        }

        result = await self.locations.update_one(
            query,
            {"$set": doc},
            upsert=True
        )

        return bool(result.upserted_id or result.modified_count > 0)

    def _parse_citytag_timestamp(self, value) -> datetime:
        """
        Stores timestamps as-is (wall-clock time, no timezone conversion).

        CityTag returns PKT times without a tz suffix e.g. "2025-02-24T10:30:00".
        We store exactly that value so it matches what the frontend date pickers
        send — the picker value "10:30" is appended with Z and sent as 10:30Z,
        which MongoDB sees as 10:30, matching the stored 10:30 directly.

        Epoch integers are converted from UTC epoch to a naive datetime via
        utcfromtimestamp so they're also stored in wall-clock UTC terms.
        """
        if isinstance(value, (int, float)):
            # Millisecond epoch
            if value > 1e10:
                return datetime.utcfromtimestamp(value / 1000)
            return datetime.utcfromtimestamp(value)

        if isinstance(value, str):
            try:
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
                # Strip any tz info and store the wall-clock value as-is
                return dt.replace(tzinfo=None)
            except Exception:
                pass

        if isinstance(value, datetime):
            # Strip tz and store wall-clock value directly
            return value.replace(tzinfo=None)

        return datetime.utcnow()  # fallback