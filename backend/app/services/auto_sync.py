import asyncio
from datetime import datetime, timedelta
import logging
from httpx import HTTPStatusError

from app.dependencies import get_settings
from app.services.mongodb import MongoService
from app.services.citytag import CityTagClient, CityTagError
from app.routers.auth import login, LoginRequest


SYNC_INTERVAL_SECONDS = 60  # run every 60 seconds
CITYTAG_PASSWORD = "Trakker123"
logger = logging.getLogger(__name__)


async def try_relogin(email: str, uid: str, mongo: MongoService, citytag: CityTagClient) -> str | None:
    """
    Attempt to re-login to CityTag and update token in admin collection
    """

    logger.info("auto_sync try_relogin started email=%s uid=%s", email, uid)

    try:

        payload = LoginRequest(
            email=email,
            password=CITYTAG_PASSWORD,
            uid=uid
        )

        await login(payload=payload, mongo=mongo, citytag=citytag)

        admin_doc = await mongo.admins.find_one({"email": email})

        if admin_doc and admin_doc.get("citytag_token"):
            logger.info("auto_sync try_relogin success email=%s", email)
            return admin_doc["citytag_token"]

        logger.warning("auto_sync try_relogin token_missing email=%s", email)
        return None

    except Exception as exc:

        logger.exception("auto_sync try_relogin failed email=%s", email)
        return None


async def get_user_devices(citytag: CityTagClient, uid: str, token: str, email: str):
    """
    Fetch devices for a user. Returns None if token expired
    """

    try:

        devices = await citytag.get_devices(uid=uid, token=token)
        return devices

    except (CityTagError, HTTPStatusError) as e:

        msg = str(e).lower()

        if any(
            kw in msg for kw in [
                "token",
                "expired",
                "invalid token",
                "invalid",
                "401",
                "unauthorized",
                "400",
                "bad request"
            ]
        ):
            logger.warning("auto_sync token_invalid_or_expired email=%s error=%s", email, e)
            return None

        logger.error("auto_sync get_user_devices failed email=%s error=%s", email, e)
        return []


async def sync_all_users() -> None:
    """
    Sync location history for all admins and their devices
    """

    settings = get_settings()

    mongo = MongoService(settings["mongo_uri"])
    citytag = CityTagClient(settings["citytag_base_url"])

    logger.info("auto_sync started")

    total_admins = 0
    total_devices = 0
    total_points = 0
    re_logins = 0

    async for admin in mongo.admins.find({}):

        total_admins += 1

        email = admin.get("email")
        uid = admin.get("uid")
        token = admin.get("citytag_token")

        if not all([email, uid]):
            logger.warning("auto_sync skipping_admin missing_email_or_uid")
            continue

        current_token = token

        devices = (
            await get_user_devices(citytag, uid, current_token, email)
            if current_token else None
        )

        # token expired → relogin
        if devices is None:

            new_token = await try_relogin(email, uid, mongo, citytag)

            if new_token:

                current_token = new_token
                re_logins += 1

                devices = await get_user_devices(citytag, uid, current_token, email)

                if devices is None:
                    logger.warning("auto_sync devices_unavailable_after_relogin email=%s", email)
                    continue

            else:
                logger.warning("auto_sync relogin_failed email=%s", email)
                continue

        if not devices:
            logger.info("auto_sync no_devices email=%s", email)
            continue

        total_devices += len(devices)

        start_time = datetime.utcnow() - timedelta(minutes=15)
        end_time = datetime.utcnow()

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
                    end_time=end_time,
                )

            except (CityTagError, HTTPStatusError) as e:
                logger.error("auto_sync history_fetch_failed email=%s sn=%s error=%s", email, sn, e)
                continue

            inserted_this_device = 0

            for item in history:

                inserted = await mongo.upsert_location_from_citytag(
                    history_item=item,
                    uid=uid,
                    sn=sn,
                )

                if inserted:

                    inserted_this_device += 1
                    total_points += 1

            if inserted_this_device:
                logger.info("auto_sync inserted_points email=%s sn=%s count=%s", email, sn, inserted_this_device)
    logger.info(
        "auto_sync completed admins=%s relogins=%s devices=%s points=%s",
        total_admins,
        re_logins,
        total_devices,
        total_points,
    )


async def scheduler_loop() -> None:

    await sync_all_users()

    while True:

        await asyncio.sleep(SYNC_INTERVAL_SECONDS)

        await sync_all_users()


def start_auto_sync_tasks(app):

    @app.on_event("startup")
    async def start_scheduler():
        logger.info("auto_sync scheduler_starting")

        asyncio.create_task(scheduler_loop())