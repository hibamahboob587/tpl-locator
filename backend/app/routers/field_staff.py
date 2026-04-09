from datetime import datetime, timedelta
import logging
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends
from bson import ObjectId

from app.dependencies import get_current_admin, get_mongo_service
from app.models.admin import AdminInDB
from app.services.mongodb import MongoService

router = APIRouter(prefix="/api/field-staff", tags=["field_staff"])
logger = logging.getLogger(__name__)

ONLINE_THRESHOLD_MINUTES = 30


def _is_online(timestamp) -> bool:
    if not timestamp:
        return False
    if isinstance(timestamp, str):
        try:
            timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except Exception:
            return False
    if not isinstance(timestamp, datetime):
        return False
    if timestamp.tzinfo is not None:
        timestamp = timestamp.replace(tzinfo=None)
    return (datetime.utcnow() - timestamp) < timedelta(minutes=ONLINE_THRESHOLD_MINUTES)


def _fmt_dt(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _to_oid(value) -> Optional[ObjectId]:
    if value is None:
        return None
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except Exception:
        return None


@router.get("/live-devices")
async def get_live_devices(
    admin: Annotated[AdminInDB, Depends(get_current_admin)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
) -> List[dict]:
    """
    Returns all devices under this admin enriched with their latest GPS coordinates.
    - isOnline: true if the latest location timestamp is < 30 minutes ago
    - latitude/longitude: populated for all devices that have location data (not just online)
    - region, location, zone: admin-defined geographic labels stored on the device doc
    - assignedUser: display name of the user the device is assigned to
    """
    logger.info("get_live_devices started admin=%s", admin.email)

    docs = await mongo.devices.find({"admin_id": admin.id}).to_list(None)
    if not docs:
        return []

    sns = [str(d["sn"]) for d in docs if d.get("sn")]

    # ── Batch-fetch latest location per SN ──────────────────────────────
    latest_by_sn: dict[str, dict] = {}
    if sns:
        pipeline = [
            {"$match": {"sn": {"$in": sns}}},
            {"$sort": {"timestamp": -1}},
            {"$group": {
                "_id": "$sn",
                "timestamp": {"$first": "$timestamp"},
                "lat":       {"$first": "$lat"},
                "lng":       {"$first": "$lng"},
            }},
        ]
        async for row in mongo.locations.aggregate(pipeline):
            latest_by_sn[str(row["_id"])] = {
                "timestamp": row.get("timestamp"),
                "lat":       row.get("lat"),
                "lng":       row.get("lng"),
            }

    # ── Batch-fetch assigned users ───────────────────────────────────────
    user_oid_map: dict[str, ObjectId] = {}
    for d in docs:
        oid = _to_oid(d.get("user_id"))
        if oid:
            user_oid_map[str(oid)] = oid

    users_by_id: dict[str, dict] = {}
    if user_oid_map:
        async for user_doc in mongo.users.find({"_id": {"$in": list(user_oid_map.values())}}):
            users_by_id[str(user_doc["_id"])] = user_doc

    # ── Build response ───────────────────────────────────────────────────
    result: list[dict] = []
    for doc in docs:
        sn = doc.get("sn")
        if not sn:
            continue

        loc = latest_by_sn.get(str(sn), {})
        online = _is_online(loc.get("timestamp"))

        user_id = doc.get("user_id")
        user_doc = users_by_id.get(str(user_id)) if user_id else None
        if user_doc:
            raw_name = (user_doc.get("name") or "").strip()
            email = user_doc.get("email", "")
            user_display = raw_name or (email.split("@")[0] if "@" in email else email) or None
        else:
            user_display = None

        result.append({
            "sn":             sn,
            "name":           doc.get("name") or doc.get("assigned_name") or sn,
            "assignedUser":   user_display,
            "assignedUserId": str(user_id) if user_id else None,
            "region":         doc.get("region") or None,
            "location":       doc.get("location") or None,
            "zone":           doc.get("zone") or None,
            "latitude":       loc.get("lat"),
            "longitude":      loc.get("lng"),
            "lastSeen":       _fmt_dt(loc.get("timestamp")),
            "isOnline":       online,
        })

    logger.info("get_live_devices completed admin=%s count=%s", admin.email, len(result))
    return result
