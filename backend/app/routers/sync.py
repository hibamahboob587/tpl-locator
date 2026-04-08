from fastapi import APIRouter, Depends, HTTPException, status
import logging
from typing import Annotated
from datetime import datetime, timedelta
import asyncio
import json
from pathlib import Path
from httpx import AsyncClient, HTTPStatusError, ConnectTimeout, RequestError

from app.dependencies import get_citytag_client, get_mongo_service
from app.services.citytag import CityTagClient, CityTagError
from app.services.mongodb import MongoService


router = APIRouter(prefix="/api", tags=["sync"])
logger = logging.getLogger(__name__)


CITYTAG_PASSWORD = "Trakker123"

ZOQIN_BASE_URL = "https://www.zoqin.com/ZQGPS/Device/getLocationListByTimeAndSN"

ZOQIN_DEVICE_JSON_PATH = Path(__file__).resolve().parents[1] / "data" / "zoqin_devices.json"


# -----------------------------------------------------
# RELLOGIN FUNCTION
# -----------------------------------------------------

async def try_relogin(email: str, uid: str, mongo: MongoService, citytag: CityTagClient):
    logger.info("sync try_relogin started email=%s uid=%s", email, uid)

    try:
        # CityTag login is done inside sync to prevent CityTag outages from affecting end-user endpoints.
        token_response = await citytag.login(username=email, password=CITYTAG_PASSWORD)
        token = token_response.get("token") if isinstance(token_response, dict) else None
        if not token:
            logger.warning("sync try_relogin token_missing email=%s", email)
            return None

        admin_doc = await mongo.admins.find_one({"email": email})
        if not admin_doc:
            logger.warning("sync try_relogin admin_missing email=%s", email)
            return None

        await mongo.update_admin_token(str(admin_doc["_id"]), token)
        logger.info("sync try_relogin success email=%s", email)
        return token

    except Exception as exc:

        logger.exception("sync try_relogin failed email=%s", email)
        return None


# -----------------------------------------------------
# DEVICE FETCH FUNCTION
# -----------------------------------------------------

async def get_devices(citytag: CityTagClient, uid: str, token: str, email: str):
    """
    Fetch devices from CityTag with retry + token-error signalling.

    Returns:
      list      — on success (possibly empty)
      []        — on non-token errors (including repeated timeouts)
      None      — when the token is considered invalid/expired
    """
    max_retries = 3
    base_delay_seconds = 2

    for attempt in range(1, max_retries + 1):
        try:
            devices = await citytag.get_devices(uid=uid, token=token)
            if attempt > 1:
                logger.info(
                    "sync get_devices succeeded after_retry email=%s attempts=%s",
                    email,
                    attempt,
                )
            return devices

        except (CityTagError, HTTPStatusError) as e:
            msg = str(e).lower()

            # Treat auth/400-style problems as token issues that require relogin.
            if any(
                x in msg
                for x in [
                    "token",
                    "expired",
                    "invalid",
                    "401",
                    "unauthorized",
                    "400",
                    "bad request",
                ]
            ):
                logger.warning("sync get_devices token_expired email=%s", email)
                return None

            logger.error(
                "sync get_devices failed email=%s attempt=%s/%s error=%s",
                email,
                attempt,
                max_retries,
                e,
            )

        except (ConnectTimeout, RequestError) as e:
            # Network/timeout errors are transient — retry a few times.
            logger.warning(
                "sync get_devices network_error email=%s attempt=%s/%s error=%s",
                email,
                attempt,
                max_retries,
                e,
            )

        # If we have more attempts left, back off before retrying.
        if attempt < max_retries:
            delay = base_delay_seconds * attempt
            await asyncio.sleep(delay)

    # After all retries, give up for this admin in this run but keep sync alive.
    logger.error("sync get_devices giving_up email=%s retries=%s", email, max_retries)
    return []


def load_zoqin_device_sns() -> list[str]:
    """
    Load vendor device serial numbers from JSON so ops can update SNs without code edits.
    Supported JSON formats:
    - {"devices": ["SN1", "SN2"]}
    - {"devices": [{"sn": "SN1"}, {"sn": "SN2"}]}
    - [{"sn": "SN1"}, {"sn": "SN2"}]
    """
    if not ZOQIN_DEVICE_JSON_PATH.exists():
        logger.warning("sync zoqin_devices_json_missing path=%s", ZOQIN_DEVICE_JSON_PATH)
        return []

    try:
        with ZOQIN_DEVICE_JSON_PATH.open("r", encoding="utf-8") as fp:
            payload = json.load(fp)
    except Exception:
        logger.exception("sync zoqin_devices_json_read_failed path=%s", ZOQIN_DEVICE_JSON_PATH)
        return []

    devices_block = payload.get("devices", []) if isinstance(payload, dict) else payload
    if not isinstance(devices_block, list):
        return []

    sns: list[str] = []
    for item in devices_block:
        sn_value = item if isinstance(item, str) else (item.get("sn") if isinstance(item, dict) else None)
        if sn_value:
            sns.append(str(sn_value).strip())

    # Preserve order from JSON and drop duplicates/blanks.
    seen: set[str] = set()
    unique_sns: list[str] = []
    for sn in sns:
        if sn and sn not in seen:
            seen.add(sn)
            unique_sns.append(sn)
    return unique_sns


async def sync_zoqin_vendor_locations(mongo: MongoService) -> tuple[int, int]:
    """
    Sync locations for Zoqin vendor devices listed in JSON.
    Returns:
      (devices_processed, points_inserted)
    """
    device_sns = load_zoqin_device_sns()
    if not device_sns:
        logger.info("sync zoqin_no_devices_in_json")
        return (0, 0)

    admin_doc = await mongo.admins.find_one({"email": "tpl@gmail.com"})
    if not admin_doc:
        logger.warning("sync zoqin_admin_missing email=tpl@gmail.com")
        return (0, 0)

    admin_id = str(admin_doc.get("_id")) if admin_doc.get("_id") is not None else None
    uid = admin_doc.get("uid") or "zoqin_vendor_tpl"
    if not admin_id:
        logger.warning("sync zoqin_admin_id_missing email=tpl@gmail.com")
        return (0, 0)

    now = datetime.utcnow()
    start_time = now.strftime("%Y-%m-%d 00:00:00")
    end_time = now.strftime("%Y-%m-%d 23:59:59")

    devices_processed = 0
    points_inserted = 0

    async with AsyncClient(timeout=20.0) as client:
        for sn in device_sns:
            # Keep devices table coherent with vendor list before location ingest.
            await mongo.upsert_device_from_citytag(
                admin_id=admin_id,
                citytag_device={
                    "sn": sn,
                    "assigned_name": sn,
                },
            )

            try:
                response = await client.get(
                    ZOQIN_BASE_URL,
                    params={
                        "sn": sn,
                        "startTime": start_time,
                        "endTime": end_time,
                    },
                )
                response.raise_for_status()
                payload = response.json()
            except Exception as exc:
                logger.error("sync zoqin_fetch_failed sn=%s error=%s", sn, exc)
                continue

            if not isinstance(payload, dict) or payload.get("code") != 200:
                logger.warning("sync zoqin_bad_payload sn=%s code=%s", sn, payload.get("code") if isinstance(payload, dict) else None)
                continue

            history = payload.get("data") or []
            if not isinstance(history, list):
                continue

            devices_processed += 1

            for item in history:
                if not isinstance(item, dict):
                    continue
                inserted = await mongo.upsert_location_from_citytag(
                    history_item={
                        "sn": item.get("sn") or sn,
                        "latitude": item.get("latitude"),
                        "longitude": item.get("longitude"),
                        "gpstime": item.get("positioningTime") or item.get("publishTime"),
                    },
                    uid=uid,
                    sn=sn,
                )
                if inserted:
                    points_inserted += 1

    logger.info("sync zoqin_completed devices=%s points=%s", devices_processed, points_inserted)
    return (devices_processed, points_inserted)


# -----------------------------------------------------
# MAIN SYNC API
# -----------------------------------------------------

@router.post("/sync/all")
async def sync_all_admin_locations(
    citytag: Annotated[CityTagClient, Depends(get_citytag_client)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    logger.info("sync_all_admin_locations started")

    total_admins = 0
    total_devices = 0
    total_points = 0
    relogins = 0
    zoqin_devices = 0
    zoqin_points = 0

    start_time = datetime.utcnow() - timedelta(minutes=10)
    end_time = datetime.utcnow()

    async for admin in mongo.admins.find({}):

        total_admins += 1

        email = admin.get("email")
        uid = admin.get("uid")
        admin_id = str(admin.get("_id")) if admin.get("_id") is not None else None
        token = admin.get("citytag_token")

        if not email or not uid:
            logger.warning("sync skipping_admin missing_email_or_uid")
            continue

        current_token = token

        devices = await get_devices(citytag, uid, current_token, email) if current_token else None

        # TOKEN EXPIRED
        if devices is None:

            new_token = await try_relogin(email, uid, mongo, citytag)

            if not new_token:
                logger.warning("sync relogin_failed email=%s", email)
                continue

            relogins += 1
            current_token = new_token

            devices = await get_devices(citytag, uid, current_token, email)

            if devices is None:
                logger.warning("sync devices_still_unavailable email=%s", email)
                continue

        if not devices:
            logger.info("sync no_devices email=%s", email)
            continue

        total_devices += len(devices)

        for device in devices:

            if isinstance(device, dict):
                # Persist device metadata into Mongo so listing endpoints are CityTag-free.
                await mongo.upsert_device_from_citytag(
                    admin_id=admin_id,
                    citytag_device=device,
                )

            sn = device.get("sn")

            if not sn:
                continue

            try:

                history = await citytag.get_location_history(
                    uid=uid,
                    token=current_token,
                    sn=sn,
                    start_time=start_time,
                    end_time=end_time
                )

            except (CityTagError, HTTPStatusError) as e:
                logger.error("sync history_fetch_failed email=%s sn=%s error=%s", email, sn, e)
                continue

            inserted_device_points = 0

            for item in history:

                inserted = await mongo.upsert_location_from_citytag(
                    history_item=item,
                    uid=uid,
                    sn=sn
                )

                if inserted:
                    inserted_device_points += 1
                    total_points += 1

            if inserted_device_points:
                logger.info("sync inserted_points email=%s sn=%s count=%s", email, sn, inserted_device_points)
    try:
        zoqin_devices, zoqin_points = await sync_zoqin_vendor_locations(mongo)
        total_devices += zoqin_devices
        total_points += zoqin_points
    except Exception:
        logger.exception("sync zoqin_unhandled_failure")

    logger.info("sync_all_admin_locations completed admins=%s devices=%s points=%s relogins=%s", total_admins, total_devices, total_points, relogins)

    return {
        "admins_processed": total_admins,
        "devices_processed": total_devices,
        "points_inserted": total_points,
        "relogins": relogins,
        "sync_window_minutes": 10,
        "zoqin_devices_processed": zoqin_devices,
        "zoqin_points_inserted": zoqin_points,

    }


