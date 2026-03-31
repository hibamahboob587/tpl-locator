from datetime import datetime, timedelta
import logging
from typing import Annotated, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.dependencies import get_current_account, get_current_user, get_mongo_service
from app.models.admin import AdminInDB
from app.models.user import UserInDB
from app.services.mongodb import MongoService
from app.services.device_binding import bind_device_service, unbind_device_service
from bson import ObjectId


router = APIRouter(prefix="/api", tags=["devices"])
logger = logging.getLogger(__name__)

# Device is considered online if it has a location update within this many minutes
ONLINE_THRESHOLD_MINUTES = 30


def _fmt_dt(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return str(value)


def _get_device_status(latest_timestamp) -> str:
    """Determine if device is online or offline based on latest location timestamp."""
    if not latest_timestamp:
        return "offline"
    if isinstance(latest_timestamp, str):
        try:
            latest_timestamp = datetime.fromisoformat(latest_timestamp.replace("Z", "+00:00"))
        except Exception:
            return "offline"
    if not isinstance(latest_timestamp, datetime):
        return "offline"
    # Strip timezone for naive UTC comparison — stored timestamps are naive UTC
    if latest_timestamp.tzinfo is not None:
        latest_timestamp = latest_timestamp.replace(tzinfo=None)
    if (datetime.utcnow() - latest_timestamp) < timedelta(minutes=ONLINE_THRESHOLD_MINUTES):
        return "online"
    return "offline"


async def _enrich_device(doc: dict, user: UserInDB, mongo: MongoService) -> dict:
    """Build a full device row matching the shape DevicesTable expects."""
    device_sn = doc.get("sn")

    # dataRetrievalTime — latest location timestamp from locations collection
    latest_loc = await mongo.locations.find_one(
        {"sn": device_sn},
        sort=[("timestamp", -1)],
    )
    data_retrieval_time = _fmt_dt(latest_loc.get("timestamp")) if latest_loc else None

    # Online/offline status based on latest location timestamp
    device_status = _get_device_status(latest_loc.get("timestamp")) if latest_loc else "offline"

    # assigned_user_name — use the label entered at bind time (stored as device name),
    # fall back to the user's account name or email
    assigned_user_name = doc.get("name") or user.name or user.email or None

    # assigned_name — label used by the UI when `name` is empty.
    assigned_name = doc.get("assigned_name") or doc.get("name") or device_sn

    # client — stored on the device doc at bind time
    client = doc.get("client") or None

    return {
        "sn":                 device_sn,
        "name":               doc.get("name", ""),
        "assigned_name":     assigned_name,
        "client":             client,
        "status":             device_status,
        "assigned_user_name": assigned_user_name,
        "assigned_user_id":   str(user.id),
        # Frontend legacy alias (used by dashboard pages).
        "assignedUser":      assigned_user_name,
        "dataRetrievalTime":  data_retrieval_time,
        "bindTime":           _fmt_dt(doc.get("bound_at")),
        "local_id":           str(doc.get("_id")),
    }


def _to_oid(value) -> ObjectId | None:
    if value is None:
        return None
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except Exception:
        return None


async def _enrich_admin_devices(admin: AdminInDB, mongo: MongoService) -> List[dict]:
    """
    Build an admin-facing device list purely from Mongo.

    This keeps GET /api/devices stable even if CityTag is down, because it only relies on:
    - mongo.devices (binding/name/client/region/user assignment)
    - mongo.locations (latest timestamp -> status + dataRetrievalTime)
    - mongo.users (assigned user display name)
    """
    logger.info("enrich_admin_devices started admin=%s", admin.email)

    docs = await mongo.devices.find({"admin_id": admin.id}).to_list(None)
    if not docs:
        return []

    sns = [str(d.get("sn")) for d in docs if d.get("sn")]
    sns_set = set(sns)

    # Latest location per SN via aggregation to avoid N+1 queries
    latest_by_sn: dict[str, dict] = {}
    if sns_set:
        pipeline = [
            {"$match": {"sn": {"$in": list(sns_set)}}},
            {"$sort": {"timestamp": -1}},
            {"$group": {"_id": "$sn", "timestamp": {"$first": "$timestamp"}}},
        ]
        async for row in mongo.locations.aggregate(pipeline):
            latest_by_sn[str(row["_id"])] = {"timestamp": row.get("timestamp")}

    # Prefetch users referenced by device.user_id
    user_oids: list[ObjectId] = []
    for d in docs:
        oid = _to_oid(d.get("user_id"))
        if oid:
            user_oids.append(oid)
    user_oids = list({str(o): o for o in user_oids}.values())  # de-dupe preserving values

    users_by_id: dict[str, dict] = {}
    if user_oids:
        async for user_doc in mongo.users.find({"_id": {"$in": user_oids}}):
            users_by_id[str(user_doc["_id"])] = user_doc

    def resolve_user_display(user_oid) -> tuple[str | None, str | None]:
        oid = _to_oid(user_oid)
        if not oid:
            return None, None
        user_doc = users_by_id.get(str(oid))
        if not user_doc:
            return str(oid), None
        name = (user_doc.get("name") or "").strip()
        email = user_doc.get("email") or ""
        display = name or (email.split("@")[0] if "@" in email else email) or None
        return str(oid), display

    result: list[dict] = []
    for doc in docs:
        device_sn = doc.get("sn")
        if not device_sn:
            continue

        latest_ts = latest_by_sn.get(str(device_sn), {}).get("timestamp") if latest_by_sn else None
        data_retrieval_time = _fmt_dt(latest_ts) if latest_ts else None
        device_status = _get_device_status(latest_ts) if latest_ts else "offline"

        assigned_user_id, assigned_user_name = resolve_user_display(doc.get("user_id"))

        # DevicesTable expects these keys for sorting/filtering/rendering.
        # Keep `name` faithful to Mongo (it can legitimately be empty), so `assigned_name`
        # can still be displayed by the frontend when `name` is stale/blank.
        device_name = doc.get("name", "") or ""
        assigned_name = (
            doc.get("assigned_name")
            or (device_name if device_name and device_name != device_sn else None)
            or device_sn
        )

        result.append({
            "sn": device_sn,
            "local_id": str(doc.get("_id")),
            "name": device_name,
            "assigned_name": assigned_name,
            "client": doc.get("client") or None,
            "status": device_status,
            "assigned_user_name": assigned_user_name,
            "assigned_user_id": assigned_user_id,
            # Frontend legacy alias (used by dashboard pages).
            "assignedUser": assigned_user_name,
            "dataRetrievalTime": data_retrieval_time,
            "bindTime": _fmt_dt(doc.get("bound_at")),
            "region": doc.get("region") or None,

            # Optional legacy fields that old admin enrichment included.
            "local_only": bool(doc.get("local_only")) if doc.get("local_only") is not None else None,
            "datapoint_count": doc.get("datapoint_count", 0),
            "last_seen": doc.get("last_seen") or doc.get("lastSeen") or None,
            "first_seen": doc.get("first_seen") or None,
        })

    logger.info("enrich_admin_devices completed admin=%s result_count=%s", admin.email, len(result))
    return result


@router.get("/devices")
async def list_user_devices(
    account: Annotated[Union[AdminInDB, UserInDB], Depends(get_current_account)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
) -> List[dict]:
    """
    Return devices for the logged-in account.
    - User: only their assigned devices, fully enriched for DevicesTable.
    - Admin: enriched list for DevicesTable (Mongo-backed; no CityTag calls).
    """
    logger.info("list_user_devices started account_email=%s", account.email)
    if isinstance(account, UserInDB):
        ids = account.devices
        if not ids:
            return []
        docs = await mongo.devices.find({"_id": {"$in": ids}}).to_list(None)
        result = []
        for doc in docs:
            enriched = await _enrich_device(doc, account, mongo)
            result.append(enriched)
        logger.info("list_user_devices completed account_email=%s count=%s", account.email, len(result))
        return result

    # Admin path — enriched list for the admin's devices
    result = await _enrich_admin_devices(account, mongo)
    logger.info("list_user_devices completed admin_email=%s count=%s", account.email, len(result))
    return result


class BindDeviceRequest(BaseModel):
    sn: str
    email: Optional[str] = None  # optional, admin can set user by email
    name: Optional[str] = None    # label shown in table; stamped on device doc at bind time
    client: Optional[str] = None  # optional client/company name
    user_id: Optional[str] = None # admin-only: assign to a specific user


@router.post("/devices")
async def bind_device(
    payload: BindDeviceRequest,
    current_account: Annotated[Union[AdminInDB, UserInDB], Depends(get_current_account)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    """
    Bind a device to a user.

    Regular user path: device must exist and be unassigned (or already theirs).
      - name and client from the request are stamped on the device doc.
      - user is auto-linked to the device's admin if not already linked.

    Admin-initiated path: pass user_id to assign an unbound device to a
      specific user under the same admin. name/client are optional stamps.
    """
    try:
        logger.info(
            "bind_device route started actor=%s sn=%s target_email=%s target_user_id=%s",
            current_account.email,
            payload.sn,
            payload.email,
            payload.user_id,
        )
        response = await bind_device_service(
            current_account=current_account,
            sn=payload.sn,
            email=payload.email,
            user_id=payload.user_id,
            name=payload.name,
            client=payload.client,
            mongo=mongo,
        )
        logger.info("bind_device route completed actor=%s sn=%s", current_account.email, payload.sn)
        return response

    except HTTPException:
        raise
    except Exception as err:
        logger.exception("bind_device route failed actor=%s sn=%s", current_account.email, payload.sn)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal error: {str(err)}",
        )


@router.delete("/devices/{sn}")
async def unbind_device(
    sn: str,
    current_account: Annotated[Union[AdminInDB, UserInDB], Depends(get_current_account)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    """Unassign a device from the current user."""
    try:
        logger.info("unbind_device route started actor=%s sn=%s", current_account.email, sn)
        response = await unbind_device_service(
            current_account=current_account,
            sn=sn,
            mongo=mongo,
        )
        logger.info("unbind_device route completed actor=%s sn=%s", current_account.email, sn)
        return response

    except HTTPException:
        raise
    except Exception as err:
        logger.exception("unbind_device route failed actor=%s sn=%s", current_account.email, sn)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(err),
        )