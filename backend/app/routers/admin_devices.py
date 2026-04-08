from datetime import datetime, timedelta
import logging
from typing import Annotated, Any, Dict, List
from bson import ObjectId

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.dependencies import get_current_admin, get_mongo_service
from app.models.admin import AdminInDB
from app.services.mongodb import MongoService
from app.routers.devices import _enrich_admin_devices


router = APIRouter(prefix="/api/admin", tags=["admin_devices"])
logger = logging.getLogger(__name__)

ADMIN_MAX_DEVICES = 2000
ONLINE_THRESHOLD_MINUTES = 30


class AssignDeviceRequest(BaseModel):
    sn: str
    user_id: str | None = None
    name: str = ""


def _fmt_dt(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return str(value)


def _to_oid(value) -> ObjectId | None:
    if value is None:
        return None
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def _get_device_status(latest_timestamp) -> str:
    if not latest_timestamp:
        return "offline"
    if isinstance(latest_timestamp, str):
        try:
            latest_timestamp = datetime.fromisoformat(latest_timestamp.replace("Z", "+00:00"))
        except Exception:
            return "offline"
    if not isinstance(latest_timestamp, datetime):
        return "offline"
    if latest_timestamp.tzinfo is not None:
        latest_timestamp = latest_timestamp.replace(tzinfo=None)
    if (datetime.utcnow() - latest_timestamp) < timedelta(minutes=ONLINE_THRESHOLD_MINUTES):
        return "online"
    return "offline"


async def _clear_binding(mongo: MongoService, sn: str) -> None:
    await mongo.devices.update_one(
        {"sn": sn},
        {"$unset": {"user_id": "", "name": "", "client": "", "bound_at": ""}},
    )


async def _lookup_user_name(mongo: MongoService, raw_user_id) -> tuple[str | None, str | None]:
    user_oid = _to_oid(raw_user_id)
    if not user_oid:
        return None, None
    user_doc = await mongo.users.find_one({"_id": user_oid})
    if not user_doc:
        return str(raw_user_id), None
    name = (user_doc.get("name") or "").strip()
    display = name or user_doc.get("email", "").split("@")[0] or None
    return str(raw_user_id), display


async def _bulk_prefetch(mongo: MongoService, sns: list[str]) -> tuple[dict, dict, dict]:
    """
    Replace N*3 sequential DB calls with exactly 3 bulk queries.
    Returns: local_by_sn, latest_by_sn, users_by_id
    """
    if not sns:
        return {}, {}, {}

    # 1. All local device docs
    local_by_sn = {}
    async for doc in mongo.devices.find({"sn": {"$in": sns}}):
        local_by_sn[doc["sn"]] = doc

    # 2. Latest location per SN via aggregation
    latest_by_sn = {}
    pipeline = [
        {"$match": {"sn": {"$in": sns}}},
        {"$sort": {"timestamp": -1}},
        {"$group": {"_id": "$sn", "timestamp": {"$first": "$timestamp"}}},
    ]
    async for row in mongo.locations.aggregate(pipeline):
        latest_by_sn[row["_id"]] = {"timestamp": row["timestamp"]}

    # 3. All referenced users
    user_oids = [
        _to_oid(doc.get("user_id"))
        for doc in local_by_sn.values()
        if doc.get("user_id")
    ]
    user_oids = [o for o in user_oids if o]  # filter None

    users_by_id = {}
    if user_oids:
        async for user_doc in mongo.users.find({"_id": {"$in": user_oids}}):
            users_by_id[str(user_doc["_id"])] = user_doc

    return local_by_sn, latest_by_sn, users_by_id


def _resolve_user(raw_user_id, users_by_id: dict) -> tuple[str | None, str | None]:
    """Resolve display name from pre-fetched dict — no DB call."""
    if not raw_user_id:
        return None, None
    oid = _to_oid(raw_user_id)
    if not oid:
        return None, None
    user_doc = users_by_id.get(str(oid))
    if not user_doc:
        return str(raw_user_id), None
    name = (user_doc.get("name") or "").strip()
    display = name or user_doc.get("email", "").split("@")[0] or None
    return str(raw_user_id), display


@router.get("/devices")
async def list_admin_devices(
    current_admin: Annotated[AdminInDB, Depends(get_current_admin)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
    sn: str | None = Query(default=None, description="Optional device SN filter"),
) -> List[Dict[str, Any]]:
    logger.info("list_admin_devices started admin=%s sn_filter=%s", current_admin.email, sn)
    try:
        result = await _enrich_admin_devices(current_admin, mongo)
    except Exception as exc:
        logger.exception("list_admin_devices failed admin=%s", current_admin.email)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal error: {str(exc)}",
        )

    if sn:
        result = [d for d in result if str(d.get("sn")) == sn]

    logger.info("list_admin_devices completed admin=%s result_count=%s", current_admin.email, len(result))
    return result


@router.get("/devices/search/{sn}")
async def search_device_for_binding(
    sn: str,
    current_admin: Annotated[AdminInDB, Depends(get_current_admin)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    logger.info("search_device_for_binding started admin=%s sn=%s", current_admin.email, sn)
    try:
        local_device = await mongo.devices.find_one({"sn": sn})
        if local_device:
            d = dict(local_device)
            d["_id"] = str(d["_id"])
            logger.info("search_device_for_binding found_in_local admin=%s sn=%s", current_admin.email, sn)
            return {"found": True, "source": "local", "device": d}
    except Exception as err:
        logger.warning("search_device_for_binding local_error admin=%s sn=%s error=%s", current_admin.email, sn, err)

    logger.info("search_device_for_binding not_found admin=%s sn=%s", current_admin.email, sn)
    return {"found": False, "source": None, "device": None}


@router.post("/devices")
async def admin_add_device(
    payload: AssignDeviceRequest,
    current_admin: Annotated[AdminInDB, Depends(get_current_admin)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    logger.info("admin_add_device started admin=%s sn=%s", current_admin.email, payload.sn)
    existing = await mongo.get_device_by_sn(payload.sn)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Device already added")

    count = await mongo.count_devices_by_admin(str(current_admin.id))
    if count >= ADMIN_MAX_DEVICES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Device limit reached ({ADMIN_MAX_DEVICES}).")

    try:
        device = await mongo.create_device(payload.sn, str(current_admin.id), payload.name)
        if payload.user_id:
            await mongo.assign_device_to_user(payload.sn, payload.user_id)
        logger.info("admin_add_device completed admin=%s device_id=%s sn=%s", current_admin.email, device.id, payload.sn)
        return {"status": "ok", "device_id": str(device.id)}
    except Exception as err:
        logger.exception("admin_add_device failed admin=%s sn=%s", current_admin.email, payload.sn)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed: {str(err)}")


class UpdateDeviceRequest(BaseModel):
    name: str | None = None
    client: str | None = None
    region: str | None = None


@router.put("/devices/{sn}")
async def admin_update_device(
    sn: str,
    payload: UpdateDeviceRequest,
    current_admin: Annotated[AdminInDB, Depends(get_current_admin)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    logger.info("admin_update_device started admin=%s sn=%s", current_admin.email, sn)
    try:
        device = await mongo.get_device_by_sn(sn)
        if not device:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
        if str(device.admin_id) != str(current_admin.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device not owned by this admin")

        updated = await mongo.update_device(sn, payload.name, payload.client, payload.region)
        logger.info("admin_update_device completed admin=%s sn=%s", current_admin.email, sn)
        return {"status": "ok", "device": {"id": str(updated.id), "sn": updated.sn, "name": updated.name, "client": updated.client, "region": updated.region}}
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("admin_update_device failed admin=%s sn=%s", current_admin.email, sn)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed: {str(err)}")