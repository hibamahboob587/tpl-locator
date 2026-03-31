from typing import Annotated, Any, Dict, Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
import jwt

from app.dependencies import get_mongo_service, get_settings
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
    mongo: Annotated[MongoService, Depends(get_mongo_service)] = None,
) -> Dict[str, Any]:
    """
    Return the latest known location for a given device SN.
    Mongo-backed only so CityTag outages do not break the tracking platform.
    """
    try:
        role = payload.get("role")
        user_or_admin_id = payload.get("sub")

        if role == "admin":
            logger.info("get_latest_location started role=admin actor_id=%s sn=%s", user_or_admin_id, sn)
            admin = await mongo.get_admin_by_id(user_or_admin_id)
            if not admin:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin not found")

        elif role == "user":
            logger.info("get_latest_location started role=user actor_id=%s sn=%s", user_or_admin_id, sn)

            device = await mongo.get_device_by_sn(sn)
            if not device:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

            if str(device.user_id) != str(user_or_admin_id):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this device")

        else:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid role: {role}")

        logger.info("get_latest_location querying_mongodb sn=%s", sn)
        local_doc = await mongo.locations.find_one({"sn": sn}, sort=[("timestamp", -1)])
        latest = None
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