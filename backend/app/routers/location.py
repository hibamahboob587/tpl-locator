from typing import Annotated, Any, Dict, Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
import jwt

from app.dependencies import get_citytag_client, get_mongo_service, get_settings
from app.services.citytag import CityTagClient, CityTagError
from app.services.mongodb import MongoService


router = APIRouter(prefix="/api", tags=["location"])
logger = logging.getLogger(__name__)


async def get_current_token_payload(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authorization token")

    token = auth_header.split(" ", 1)[1].strip()
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings["jwt_secret_key"], algorithms=[settings["jwt_algorithm"]])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    return payload


@router.get("/location/{sn}")
async def get_latest_location(
    sn: str = Path(..., description="Device serial number"),
    payload: Dict[str, Any] = Depends(get_current_token_payload),
    citytag: Annotated[CityTagClient, Depends(get_citytag_client)] = None,
    mongo: Annotated[MongoService, Depends(get_mongo_service)] = None,
) -> Dict[str, Any]:
    """
    Return the latest known location for a given device SN.
    - Tries CityTag first (requires valid admin credentials and device registered there).
    - Falls back to local MongoDB locations collection for local-only / test devices.
    """
    try:
        role             = payload.get("role")
        user_or_admin_id = payload.get("sub")

        uid_to_use   = None
        token_to_use = None

        if role == "admin":
            logger.info("get_latest_location started role=admin actor_id=%s sn=%s", user_or_admin_id, sn)
            admin = await mongo.get_admin_by_id(user_or_admin_id)
            if not admin:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin not found")
            uid_to_use   = admin.uid
            token_to_use = admin.citytag_token

        elif role == "user":
            logger.info("get_latest_location started role=user actor_id=%s sn=%s", user_or_admin_id, sn)

            device = await mongo.get_device_by_sn(sn)
            if not device:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

            if str(device.user_id) != str(user_or_admin_id):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this device")

            # FIX: device.admin_id may be None for test/local devices — handle gracefully
            if device.admin_id:
                admin = await mongo.get_admin_by_id(str(device.admin_id))
                if admin:
                    uid_to_use   = admin.uid
                    token_to_use = admin.citytag_token
                    logger.info("get_latest_location using_admin_credentials admin_email=%s sn=%s", admin.email, sn)
                else:
                    logger.warning("get_latest_location admin_not_found admin_id=%s sn=%s", device.admin_id, sn)
            else:
                logger.info("get_latest_location no_admin_id_fallback sn=%s", sn)

        else:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid role: {role}")

        # ── Step 1: Try CityTag (only if we have valid credentials) ──────────
        latest = None
        if token_to_use and uid_to_use:
            try:
                latest = await citytag.get_latest_location(uid=uid_to_use, token=token_to_use, sn=sn)
                logger.info("get_latest_location citytag_success sn=%s", sn)
            except CityTagError as exc:
                # Device not in CityTag (local-only) — fall through to MongoDB
                logger.warning("get_latest_location citytag_error sn=%s error=%s", sn, exc)
        else:
            logger.info("get_latest_location no_citytag_credentials sn=%s", sn)

        # ── Step 2: Fall back to MongoDB locations collection ────────────────
        if not latest:
            logger.info("get_latest_location querying_mongodb sn=%s", sn)
            local_doc = await mongo.locations.find_one({"sn": sn}, sort=[("timestamp", -1)])
            if local_doc:
                latest = {
                    "lat":       local_doc.get("lat"),
                    "lng":       local_doc.get("lng"),
                    "timestamp": local_doc.get("timestamp"),
                    "speed":     local_doc.get("speed"),
                    "heading":   local_doc.get("heading"),
                    "altitude":  local_doc.get("altitude"),
                    "accuracy":  local_doc.get("accuracy"),
                }
                logger.info("get_latest_location mongodb_hit sn=%s", sn)
            else:
                logger.info("get_latest_location mongodb_miss sn=%s", sn)

        if not latest:
            return {"sn": sn, "latest": None}

        logger.info("get_latest_location completed sn=%s has_latest=%s", sn, bool(latest))
        return {"sn": sn, "latest": latest}

    except HTTPException:
        raise
    except Exception as err:
        logger.exception("get_latest_location failed sn=%s", sn)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal error: {str(err)}")