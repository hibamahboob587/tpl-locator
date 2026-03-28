from fastapi import APIRouter, Depends, HTTPException, status
import logging
from typing import Annotated
from datetime import datetime, timedelta
from httpx import HTTPStatusError

from app.dependencies import get_citytag_client, get_mongo_service
from app.services.citytag import CityTagClient, CityTagError
from app.services.mongodb import MongoService
from app.routers.auth import login, LoginRequest


router = APIRouter(prefix="/api", tags=["sync"])
logger = logging.getLogger(__name__)


CITYTAG_PASSWORD = "Trakker123"


# -----------------------------------------------------
# RELLOGIN FUNCTION
# -----------------------------------------------------

async def try_relogin(email: str, uid: str, mongo: MongoService, citytag: CityTagClient):
    logger.info("sync try_relogin started email=%s uid=%s", email, uid)

    try:

        payload = LoginRequest(
            email=email,
            password=CITYTAG_PASSWORD,
            uid=uid
        )

        await login(payload=payload, mongo=mongo, citytag=citytag)

        admin_doc = await mongo.admins.find_one({"email": email})

        if admin_doc and admin_doc.get("citytag_token"):
            logger.info("sync try_relogin success email=%s", email)
            return admin_doc["citytag_token"]

        logger.warning("sync try_relogin token_missing email=%s", email)
        return None

    except Exception as exc:

        logger.exception("sync try_relogin failed email=%s", email)
        return None


# -----------------------------------------------------
# DEVICE FETCH FUNCTION
# -----------------------------------------------------

async def get_devices(citytag: CityTagClient, uid: str, token: str, email: str):

    try:

        devices = await citytag.get_devices(uid=uid, token=token)

        return devices

    except (CityTagError, HTTPStatusError) as e:

        msg = str(e).lower()

        if any(
            x in msg for x in [
                "token",
                "expired",
                "invalid",
                "401",
                "unauthorized",
                "400",
                "bad request"
            ]
        ):
            logger.warning("sync get_devices token_expired email=%s", email)
            return None

        logger.error("sync get_devices failed email=%s error=%s", email, e)

        return []


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

    start_time = datetime.utcnow() - timedelta(minutes=10)
    end_time = datetime.utcnow()

    async for admin in mongo.admins.find({}):

        total_admins += 1

        email = admin.get("email")
        uid = admin.get("uid")
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
    logger.info("sync_all_admin_locations completed admins=%s devices=%s points=%s relogins=%s", total_admins, total_devices, total_points, relogins)

    return {
        "admins_processed": total_admins,
        "devices_processed": total_devices,
        "points_inserted": total_points,
        "relogins": relogins,
        "sync_window_minutes": 10
    }