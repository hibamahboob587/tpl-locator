from typing import Annotated, Union
from datetime import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_current_account, get_location_service, get_mongo_service
from app.models.admin import AdminInDB
from app.models.user import UserInDB
from app.models.location import TrajectoryResponse, PlaybackResponse
from app.services.location import LocationService
from app.services.mongodb import MongoService


router = APIRouter(prefix="/api", tags=["history"])
logger = logging.getLogger(__name__)


async def _resolve_uid_for_device(
    account: Union[AdminInDB, UserInDB],
    sn: str,
    mongo: MongoService,
) -> str | None:
    """
    Resolve the CityTag uid used for location queries and verify the account
    is allowed to access this device.

    Returns:
        str  — CityTag uid to pass to LocationService
        None — no CityTag uid available (local/test device); LocationService
               will fall back to querying MongoDB by SN only
    """
    device = await mongo.get_device_by_sn(sn)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if isinstance(account, AdminInDB):
        # FIX: device.admin_id may be None for test docs — allow those through
        # rather than comparing str(None) != str(account.id) → accidental 403
        if device.admin_id and str(device.admin_id) != str(account.id):
            raise HTTPException(status_code=403, detail="You do not have access to this device")
        return account.uid

    # UserInDB path — device must be assigned to this user
    if str(device.user_id) != str(account.id):
        raise HTTPException(status_code=403, detail="This device is not assigned to you")

    # Resolve uid from the device's admin so LocationService can call CityTag
    # FIX: device.admin_id may be None for test/local devices — return None
    # instead of raising 404; LocationService will use MongoDB-only fallback
    if device.admin_id:
        admin = await mongo.get_admin_by_id(str(device.admin_id))
        if admin:
            return admin.uid
        logger.warning("history admin_not_found admin_id=%s sn=%s", device.admin_id, sn)

    logger.info("history no_admin_id_fallback sn=%s", sn)
    return None


@router.get("/devices/{sn}/trajectory", response_model=TrajectoryResponse)
async def get_device_trajectory(
    sn: str,
    start: Annotated[datetime, Query(...)],
    end: Annotated[datetime, Query(...)],
    account: Annotated[Union[AdminInDB, UserInDB], Depends(get_current_account)],
    service: Annotated[LocationService, Depends(get_location_service)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    """
    Get GeoJSON LineString for drawing the route on a map.
    Available to both admins (for their devices) and users (for devices assigned to them).
    """
    logger.info("get_device_trajectory started actor=%s sn=%s", account.email, sn)
    if start >= end:
        raise HTTPException(400, "start must be before end")

    uid = await _resolve_uid_for_device(account, sn, mongo)

    result = await service.get_trajectory(
        uid=uid,
        sn=sn,
        start_time=start,
        end_time=end,
    )

    if not result:
        raise HTTPException(404, "No location data found in time range")

    logger.info("get_device_trajectory completed actor=%s sn=%s count=%s", account.email, sn, result.count)
    return result


@router.get("/devices/{sn}/playback", response_model=PlaybackResponse)
async def get_device_playback(
    sn: str,
    start: Annotated[datetime, Query(...)],
    end: Annotated[datetime, Query(...)],
    account: Annotated[Union[AdminInDB, UserInDB], Depends(get_current_account)],
    service: Annotated[LocationService, Depends(get_location_service)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    """
    Get time-ordered points suitable for animation / playback.
    Available to both admins (for their devices) and users (for devices assigned to them).
    """
    logger.info("get_device_playback started actor=%s sn=%s", account.email, sn)
    if start >= end:
        raise HTTPException(400, "start must be before end")

    uid = await _resolve_uid_for_device(account, sn, mongo)

    result = await service.get_playback_points(
        uid=uid,
        sn=sn,
        start_time=start,
        end_time=end,
    )

    if not result:
        raise HTTPException(404, "No location data found in time range")

    logger.info("get_device_playback completed actor=%s sn=%s count=%s", account.email, sn, result.count)
    return result