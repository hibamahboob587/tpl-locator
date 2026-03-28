from datetime import datetime, timedelta
import logging
from typing import Annotated, Any, Dict, List
from bson import ObjectId

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.dependencies import get_citytag_client, get_current_admin, get_mongo_service
from app.models.admin import AdminInDB
from app.services.citytag import CityTagClient, CityTagError
from app.services.mongodb import MongoService


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
    citytag: Annotated[CityTagClient, Depends(get_citytag_client)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
    sn: str | None = Query(default=None, description="Optional device SN filter"),
) -> List[Dict[str, Any]]:
    logger.info("list_admin_devices started admin=%s sn_filter=%s", current_admin.email, sn)
    token = current_admin.citytag_token
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CityTag token missing; please login again")

    try:
        devices = await citytag.get_devices(uid=current_admin.uid, token=token)
        logger.info("list_admin_devices citytag_fetch_success admin=%s count=%s", current_admin.email, len(devices))
    except CityTagError as exc:
        logger.warning("list_admin_devices citytag_error admin=%s error=%s", current_admin.email, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"CityTag API error: {str(exc)}")
    except Exception as exc:
        logger.exception("list_admin_devices failed admin=%s", current_admin.email)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal error: {str(exc)}")

    if sn:
        devices = [d for d in devices if str(d.get("sn")) == sn]

    # ── Merge local-only devices ──────────────────────────────────────────────
    try:
        admin_oid = _to_oid(current_admin.id)
        query = (
            {"$or": [{"admin_id": admin_oid}, {"uid": str(current_admin.uid)}]}
            if admin_oid else {"uid": str(current_admin.uid)}
        )
        local_devices = await mongo.devices.find(query).to_list(None)
        existing_sns  = {str(d.get("sn")) for d in devices}

        for local_device in local_devices:
            device_sn = str(local_device.get("sn"))
            if device_sn not in existing_sns:
                # Mark for enrichment — data filled in bulk step below
                devices.append({"sn": device_sn, "_pending_local": True})
                existing_sns.add(device_sn)

        logger.info("list_admin_devices merge_completed admin=%s count=%s", current_admin.email, len(devices))
    except Exception as err:
        logger.exception("list_admin_devices merge_failed admin=%s", current_admin.email)

    # ── Bulk-prefetch everything in 3 queries ─────────────────────────────────
    all_sns = [str(d.get("sn")) for d in devices if d.get("sn")]
    local_by_sn, latest_by_sn, users_by_id = await _bulk_prefetch(mongo, all_sns)
    logger.info(
        "list_admin_devices prefetched admin=%s local=%s locations=%s users=%s",
        current_admin.email,
        len(local_by_sn),
        len(latest_by_sn),
        len(users_by_id),
    )

    # ── Enrich from memory — no more DB calls in this loop ────────────────────
    result = []
    for d in devices:
        device_sn = str(d.get("sn", ""))
        try:
            raw_doc    = local_by_sn.get(device_sn)
            latest_loc = latest_by_sn.get(device_sn)
            latest_ts  = latest_loc.get("timestamp") if latest_loc else None

            raw_user_id         = raw_doc.get("user_id") if raw_doc else None
            uid_str, user_name  = _resolve_user(raw_user_id, users_by_id)

            if d.get("_pending_local") or d.get("local_only"):
                result.append({
                    "sn":                 device_sn,
                    "local_id":           str(raw_doc["_id"]) if raw_doc else None,
                    "assigned_user_id":   uid_str,
                    "assigned_user_name": user_name,
                    "assigned_name":      (raw_doc.get("name") or device_sn) if raw_doc else device_sn,
                    "client":             (raw_doc.get("client") or None) if raw_doc else None,
                    "status":             _get_device_status(latest_ts),
                    "local_only":         True,
                    "datapoint_count":    (raw_doc.get("datapoint_count", 0)) if raw_doc else 0,
                    "last_seen":          (raw_doc.get("last_seen")) if raw_doc else None,
                    "first_seen":         (raw_doc.get("first_seen")) if raw_doc else None,
                    "dataRetrievalTime":  _fmt_dt(latest_ts or (raw_doc.get("last_seen") if raw_doc else None)),
                    "bindTime":           _fmt_dt(raw_doc.get("bound_at") if raw_doc else None),
                })
                continue

            # CityTag device — enrich with local data
            if raw_doc:
                d["local_id"] = str(raw_doc["_id"])
                d["bindTime"] = _fmt_dt(raw_doc.get("bound_at"))
                d["client"]   = raw_doc.get("client") or None
            else:
                d["bindTime"] = None
                d["client"]   = None

            d["assigned_user_id"]   = uid_str
            d["assigned_user_name"] = user_name
            if not uid_str:
                d["assigned_name"] = None

            citytag_last_seen = d.get("last_seen") or d.get("lastSeen") or d.get("gpstime")
            if citytag_last_seen:
                d["dataRetrievalTime"] = _fmt_dt(citytag_last_seen)
                d["status"] = _get_device_status(citytag_last_seen)
            elif latest_ts:
                d["dataRetrievalTime"] = _fmt_dt(latest_ts)
                d["status"] = _get_device_status(latest_ts)
            else:
                d["status"] = "offline"

            result.append(d)

        except Exception as err:
            logger.exception("list_admin_devices enrich_failed admin=%s sn=%s", current_admin.email, device_sn)
            result.append(d)

    logger.info("list_admin_devices completed admin=%s result_count=%s", current_admin.email, len(result))
    return result


@router.get("/devices/search/{sn}")
async def search_device_for_binding(
    sn: str,
    current_admin: Annotated[AdminInDB, Depends(get_current_admin)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
    citytag: Annotated[CityTagClient, Depends(get_citytag_client)],
):
    logger.info("search_device_for_binding started admin=%s sn=%s", current_admin.email, sn)
    try:
        citytag_devices = await citytag.get_devices(uid=current_admin.uid, token=current_admin.citytag_token)
        citytag_device = next((d for d in citytag_devices if str(d.get("sn")) == sn), None)
        if citytag_device:
            logger.info("search_device_for_binding found_in_citytag admin=%s sn=%s", current_admin.email, sn)
            return {"found": True, "source": "citytag", "device": citytag_device}
    except Exception as err:
        logger.warning("search_device_for_binding citytag_error admin=%s sn=%s error=%s", current_admin.email, sn, err)

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