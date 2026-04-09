import asyncio
from datetime import datetime, timedelta
import logging
import json
from pathlib import Path

from httpx import AsyncClient, HTTPStatusError, ConnectTimeout, RequestError, TimeoutException

from app.dependencies import get_settings
from app.services.mongodb import MongoService
from app.services.citytag import CityTagClient, CityTagError

SYNC_INTERVAL_SECONDS = 300
CITYTAG_PASSWORD = "Trakker123"

ZOQIN_BASE_URL = "https://www.zoqin.com/ZQGPS/Device/getLocationListByTimeAndSN"
ZOQIN_DEVICE_JSON_PATH = Path(__file__).resolve().parents[1] / "data" / "zoqin_devices.json"

logger = logging.getLogger(__name__)


# -----------------------------------------------------
# RELLOGIN
# -----------------------------------------------------

async def try_relogin(email: str, uid: str, mongo: MongoService, citytag: CityTagClient):
    logger.info("auto_sync try_relogin started | email=%s uid=%s", email, uid)

    try:
        token_response = await citytag.login(username=email, password=CITYTAG_PASSWORD)
        token = token_response.get("token") if isinstance(token_response, dict) else None

        if not token:
            logger.warning("auto_sync try_relogin failed - no token returned | email=%s", email)
            return None

        admin_doc = await mongo.admins.find_one({"email": email})
        if not admin_doc:
            logger.warning("auto_sync try_relogin failed - admin not found | email=%s", email)
            return None

        await mongo.update_admin_token(str(admin_doc["_id"]), token)
        logger.info("auto_sync try_relogin successful | email=%s", email)
        return token

    except Exception:
        logger.exception("auto_sync try_relogin exception | email=%s", email)
        return None


# -----------------------------------------------------
# GET DEVICES
# -----------------------------------------------------

async def get_devices(citytag: CityTagClient, uid: str, token: str, email: str):
    max_retries = 3
    base_delay = 2

    for attempt in range(1, max_retries + 1):
        try:
            devices = await citytag.get_devices(uid=uid, token=token)
            logger.info("auto_sync get_devices success | email=%s devices_count=%s", email, len(devices) if devices else 0)
            return devices

        except (CityTagError, HTTPStatusError) as e:
            msg = str(e).lower()
            if any(x in msg for x in ["token", "expired", "invalid", "401", "unauthorized", "400"]):
                logger.warning("auto_sync token issue | email=%s attempt=%s", email, attempt)
                return None
            logger.error("auto_sync get_devices error | email=%s attempt=%s error=%s", email, attempt, e)

        except (ConnectTimeout, TimeoutException, RequestError) as e:
            logger.warning("auto_sync network error | email=%s attempt=%s error=%s", email, attempt, e)

        if attempt < max_retries:
            await asyncio.sleep(base_delay * attempt)

    logger.error("auto_sync get_devices failed after retries | email=%s", email)
    return []


# -----------------------------------------------------
# LOAD ZOQIN DEVICES
# -----------------------------------------------------

def load_zoqin_device_sns():
    logger.info("auto_sync loading zoqin devices from %s", ZOQIN_DEVICE_JSON_PATH)

    if not ZOQIN_DEVICE_JSON_PATH.exists():
        logger.error("zoqin_devices.json file not found")
        return []

    try:
        with open(ZOQIN_DEVICE_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        devices = data.get("devices", []) if isinstance(data, dict) else data
        sns = [str(d.get("sn") if isinstance(d, dict) else d).strip() for d in devices if d]
        unique_sns = list(set(filter(None, sns)))

        logger.info("auto_sync zoqin devices loaded | count=%s", len(unique_sns))
        return unique_sns

    except Exception:
        logger.exception("auto_sync zoqin device loader error")
        return []


# -----------------------------------------------------
# ZOQIN SYNC
# -----------------------------------------------------

async def sync_zoqin(mongo: MongoService):
    logger.info("auto_sync zoqin sync started")

    sns = load_zoqin_device_sns()
    if not sns:
        logger.warning("auto_sync zoqin sync skipped - no devices")
        return (0, 0)

    admin = await mongo.admins.find_one({"email": "tpl@gmail.com"})
    if not admin:
        logger.error("auto_sync zoqin - admin tpl@gmail.com not found")
        return (0, 0)

    admin_id = str(admin["_id"])
    uid = admin.get("uid") or "zoqin_vendor_tpl"

    now = datetime.utcnow()
    start = now.strftime("%Y-%m-%d 00:00:00")
    end = now.strftime("%Y-%m-%d 23:59:59")

    devices_count = 0
    points_count = 0

    async with AsyncClient(timeout=30.0) as client:
        for idx, sn in enumerate(sns, 1):
            logger.info("auto_sync zoqin processing device %s/%s | sn=%s", idx, len(sns), sn)

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

            except TimeoutException:
                logger.warning("auto_sync zoqin request timeout | sn=%s", sn)
                continue
            except (ConnectTimeout, RequestError, HTTPStatusError) as e:
                logger.warning("auto_sync zoqin HTTP error | sn=%s error=%s", sn, e)
                continue
            except Exception:
                logger.exception("auto_sync zoqin request exception | sn=%s", sn)
                continue

            if payload.get("code") != 200:
                logger.warning("auto_sync zoqin API code != 200 | sn=%s code=%s", sn, payload.get("code"))
                continue

            devices_count += 1
            data_list = payload.get("data", [])

            logger.info("auto_sync zoqin API success | sn=%s items=%s", sn, len(data_list))

            for item in data_list:
                try:
                    history_item = {
                        "sn": item.get("sn") or sn,
                        "latitude": item.get("latitude"),
                        "longitude": item.get("longitude"),
                        "gpstime": item.get("positioningTime")
                    }

                    lat = history_item.get("latitude")
                    lng = history_item.get("longitude")

                    if not lat or not lng:
                        logger.debug("auto_sync zoqin skipping item - no lat/lng | sn=%s", sn)
                        continue

                    inserted = await mongo.upsert_location_from_citytag(
                        history_item=history_item,
                        uid=uid,
                        sn=sn
                    )

                    if inserted:
                        points_count += 1
                        # === SEPARATE LOG FOR ZOQIN POINT UPLOADED ===
                        logger.info("zoqin_point_uploaded | sn=%s lat=%s lng=%s gpstime=%s", 
                                   sn, lat, lng, history_item.get("gpstime"))
                    # else: duplicate or not inserted (no log needed unless you want)

                except Exception:
                    logger.exception("auto_sync zoqin upsert_location failed | sn=%s", sn)

    logger.info("auto_sync zoqin sync finished | devices=%s points=%s", devices_count, points_count)
    return (devices_count, points_count)


# -----------------------------------------------------
# MAIN SYNC (CityTag part with separate point log)
# -----------------------------------------------------

async def sync_all_users():
    settings = get_settings()

    mongo = MongoService(settings["mongo_uri"])
    citytag = CityTagClient(settings["citytag_base_url"])

    logger.info("=== auto_sync started ===")

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

        logger.info("auto_sync processing admin | email=%s", email)

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
            sn = device.get("sn")
            if not sn:
                continue

            await mongo.upsert_device_from_citytag(
                admin_id=admin_id,
                citytag_device=device
            )

            try:
                history = await citytag.get_location_history(
                    uid=uid,
                    token=current_token,
                    sn=sn,
                    start_time=start_time,
                    end_time=end_time
                )

                for item in history:
                    inserted = await mongo.upsert_location_from_citytag(
                        history_item=item,
                        uid=uid,
                        sn=sn
                    )

                    if inserted:
                        total_points += 1
                        # === SEPARATE LOG FOR CITYTAG POINT UPLOADED ===
                        lat = item.get("latitude")
                        lng = item.get("longitude")
                        gpstime = item.get("gpstime") or item.get("positioningTime")
                        logger.info("citytag_point_uploaded | sn=%s lat=%s lng=%s gpstime=%s", 
                                   sn, lat, lng, gpstime)

            except (CityTagError, HTTPStatusError):
                logger.warning("auto_sync citytag history failed | sn=%s", sn)
                continue
            except Exception:
                logger.exception("auto_sync citytag history error | sn=%s", sn)

    # ZOQIN SYNC
    try:
        z_devices, z_points = await sync_zoqin(mongo)
        total_devices += z_devices
        total_points += z_points
    except Exception:
        logger.exception("auto_sync zoqin block failed")

    logger.info(
        "=== auto_sync completed === admins=%s devices=%s points=%s relogins=%s",
        total_admins, total_devices, total_points, relogins
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