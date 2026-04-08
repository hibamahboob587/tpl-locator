import asyncio
from datetime import datetime, timedelta
import logging
import json
from pathlib import Path

from httpx import AsyncClient, HTTPStatusError, ConnectTimeout, RequestError

from app.dependencies import get_settings
from app.services.mongodb import MongoService
from app.services.citytag import CityTagClient, CityTagError


SYNC_INTERVAL_SECONDS = 300
CITYTAG_PASSWORD = "Trakker123"

ZOQIN_BASE_URL = "https://www.zoqin.com/ZQGPS/Device/getLocationListByTimeAndSN"
ZOQIN_DEVICE_JSON_PATH = Path(__file__).resolve().parents[1] / "data" / "zoqin_devices.json"

logger = logging.getLogger(__name__)


# -----------------------------------------------------
# RELLOGIN (SAME AS ROUTE)
# -----------------------------------------------------

async def try_relogin(email: str, uid: str, mongo: MongoService, citytag: CityTagClient):

    logger.info("auto_sync try_relogin started email=%s uid=%s", email, uid)

    try:
        token_response = await citytag.login(username=email, password=CITYTAG_PASSWORD)
        token = token_response.get("token") if isinstance(token_response, dict) else None

        if not token:
            return None

        admin_doc = await mongo.admins.find_one({"email": email})
        if not admin_doc:
            return None

        await mongo.update_admin_token(str(admin_doc["_id"]), token)
        return token

    except Exception:
        logger.exception("auto_sync try_relogin failed email=%s", email)
        return None


# -----------------------------------------------------
# DEVICE FETCH WITH RETRIES (MATCH ROUTE)
# -----------------------------------------------------

async def get_devices(citytag: CityTagClient, uid: str, token: str, email: str):

    max_retries = 3
    base_delay = 2

    for attempt in range(1, max_retries + 1):

        try:
            return await citytag.get_devices(uid=uid, token=token)

        except (CityTagError, HTTPStatusError) as e:

            msg = str(e).lower()

            if any(x in msg for x in [
                "token", "expired", "invalid",
                "401", "unauthorized", "400"
            ]):
                logger.warning("auto_sync token_expired email=%s", email)
                return None

            logger.error("auto_sync get_devices error email=%s attempt=%s error=%s", email, attempt, e)

        except (ConnectTimeout, RequestError) as e:
            logger.warning("auto_sync network_error email=%s attempt=%s error=%s", email, attempt, e)

        if attempt < max_retries:
            await asyncio.sleep(base_delay * attempt)

    return []


# -----------------------------------------------------
# ZOQIN DEVICE LOADER
# -----------------------------------------------------

def load_zoqin_device_sns():

    if not ZOQIN_DEVICE_JSON_PATH.exists():
        return []

    try:
        with open(ZOQIN_DEVICE_JSON_PATH, "r") as f:
            data = json.load(f)
    except Exception:
        return []

    devices = data.get("devices", []) if isinstance(data, dict) else data

    sns = []
    for d in devices:
        if isinstance(d, str):
            sns.append(d)
        elif isinstance(d, dict):
            sns.append(d.get("sn"))

    return list(set(filter(None, sns)))


# -----------------------------------------------------
# ZOQIN SYNC (MATCH ROUTE)
# -----------------------------------------------------

async def sync_zoqin(mongo: MongoService):

    sns = load_zoqin_device_sns()
    if not sns:
        return (0, 0)

    admin = await mongo.admins.find_one({"email": "tpl@gmail.com"})
    if not admin:
        return (0, 0)

    admin_id = str(admin["_id"])
    uid = admin.get("uid") or "zoqin_vendor_tpl"

    now = datetime.utcnow()
    start = now.strftime("%Y-%m-%d 00:00:00")
    end = now.strftime("%Y-%m-%d 23:59:59")

    devices_count = 0
    points_count = 0

    async with AsyncClient(timeout=20) as client:

        for sn in sns:

            await mongo.upsert_device_from_citytag(
                admin_id=admin_id,
                citytag_device={"sn": sn, "assigned_name": sn}
            )

            try:
                res = await client.get(ZOQIN_BASE_URL, params={
                    "sn": sn,
                    "startTime": start,
                    "endTime": end
                })

                res.raise_for_status()
                payload = res.json()

            except Exception:
                continue

            if payload.get("code") != 200:
                continue

            devices_count += 1

            for item in payload.get("data", []):

                inserted = await mongo.upsert_location_from_citytag(
                    history_item={
                        "sn": item.get("sn") or sn,
                        "latitude": item.get("latitude"),
                        "longitude": item.get("longitude"),
                        "gpstime": item.get("positioningTime")
                    },
                    uid=uid,
                    sn=sn
                )

                if inserted:
                    points_count += 1

    return (devices_count, points_count)


# -----------------------------------------------------
# MAIN SYNC (MATCH ROUTE)
# -----------------------------------------------------

async def sync_all_users():

    settings = get_settings()

    mongo = MongoService(settings["mongo_uri"])
    citytag = CityTagClient(settings["citytag_base_url"])

    logger.info("auto_sync started")

    total_admins = 0
    total_devices = 0
    total_points = 0
    relogins = 0

    start_time = datetime.utcnow() - timedelta(minutes=10)
    end_time = datetime.utcnow()

    async for admin in mongo.admins.find({}):

        total_admins += 1

        email = admin.get("email")
        uid = admin.get("uid")
        token = admin.get("citytag_token")
        admin_id = str(admin.get("_id"))

        if not email or not uid:
            continue

        current_token = token

        devices = await get_devices(citytag, uid, current_token, email) if current_token else None

        if devices is None:

            new_token = await try_relogin(email, uid, mongo, citytag)

            if not new_token:
                continue

            relogins += 1
            current_token = new_token

            devices = await get_devices(citytag, uid, current_token, email)

            if devices is None:
                continue

        if not devices:
            continue

        total_devices += len(devices)

        for device in devices:

            await mongo.upsert_device_from_citytag(
                admin_id=admin_id,
                citytag_device=device
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

            except (CityTagError, HTTPStatusError):
                continue

            for item in history:

                inserted = await mongo.upsert_location_from_citytag(
                    history_item=item,
                    uid=uid,
                    sn=sn
                )

                if inserted:
                    total_points += 1

    # ZOQIN SYNC
    try:
        z_devices, z_points = await sync_zoqin(mongo)
        total_devices += z_devices
        total_points += z_points
    except Exception:
        logger.exception("auto_sync zoqin failed")

    logger.info(
        "auto_sync completed admins=%s devices=%s points=%s relogins=%s",
        total_admins,
        total_devices,
        total_points,
        relogins,
    )


# -----------------------------------------------------
# SCHEDULER
# -----------------------------------------------------

async def scheduler_loop():

    await sync_all_users()

    while True:
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)
        await sync_all_users()


def start_auto_sync_tasks(app):

    @app.on_event("startup")
    async def start_scheduler():
        logger.info("auto_sync scheduler starting")
        asyncio.create_task(scheduler_loop())