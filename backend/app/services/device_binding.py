from datetime import datetime, timezone
import logging
from typing import Optional, Union

from fastapi import HTTPException, status

from app.models.admin import AdminInDB
from app.models.user import UserInDB
from app.services.mongodb import MongoService

logger = logging.getLogger(__name__)

def _is_admin(account: Union[AdminInDB, UserInDB]) -> bool:
    return isinstance(account, AdminInDB)


async def _resolve_target_user(
    current_account: Union[AdminInDB, UserInDB],
    mongo: MongoService,
    *,
    email: Optional[str] = None,
    user_id: Optional[str] = None,
) -> UserInDB:
    if user_id:
        target_user = await mongo.get_user_by_id(user_id)
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
        return target_user

    if email:
        target_user = await mongo.get_user_by_email(email.strip())
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
        return target_user

    if _is_admin(current_account):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin must provide user_id or email for target user",
        )

    # Regular user: self-target
    return current_account  # type: ignore[return-value]


async def bind_device_service(
    current_account: Union[AdminInDB, UserInDB],
    *,
    sn: str,
    mongo: MongoService,
    email: Optional[str] = None,
    user_id: Optional[str] = None,
    name: Optional[str] = None,
    client: Optional[str] = None,
) -> dict:
    logger.info(
        "bind_device_service started account_email=%s sn=%s target_email=%s target_user_id=%s",
        current_account.email,
        sn,
        email,
        user_id,
    )
    sn = (sn or "").strip()
    if not sn:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Device SN is required")

    target_user = await _resolve_target_user(current_account, mongo, email=email, user_id=user_id)

    # Non-admin cannot bind on behalf of others
    if not _is_admin(current_account) and str(target_user.id) != str(current_account.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot assign device to another user")

    # Admin must target their own users only
    if _is_admin(current_account):
        if target_user.admin_id and str(target_user.admin_id) != str(current_account.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot assign users that belong to another admin",
            )

    device = await mongo.get_device_by_sn(sn)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device does not exist. Please ask your admin to add it first.")

    if device.user_id and str(device.user_id) != str(target_user.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Device already assigned to another user")

    if not device.user_id:
        assigned = await mongo.assign_device_to_user(sn, str(target_user.id))
        if not assigned:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to assign device")

    # Stamp optional metadata
    update_fields = {}
    if name:
        update_fields["name"] = name.strip()
    if client:
        update_fields["client"] = client.strip()
    if update_fields:
        update_fields["bound_at"] = datetime.now(timezone.utc)
        await mongo.devices.update_one({"sn": sn}, {"$set": update_fields})

    # Auto-link regular user to device admin if needed
    if not _is_admin(current_account) and not current_account.admin_id and device.admin_id:
        await mongo.update_user_admin(str(current_account.id), str(device.admin_id))

    updated = await mongo.devices.find_one({"sn": sn})
    device_name = (updated or {}).get("name", "")

    logger.info(
        "bind_device_service completed actor=%s target=%s sn=%s",
        current_account.email,
        target_user.email,
        sn,
    )
    return {"status": "ok", "device_sn": sn, "device_name": device_name}


async def unbind_device_service(
    current_account: Union[AdminInDB, UserInDB],
    *,
    sn: str,
    mongo: MongoService,
    email: Optional[str] = None,
    user_id: Optional[str] = None,
) -> dict:
    logger.info(
        "unbind_device_service started account_email=%s sn=%s target_email=%s target_user_id=%s",
        current_account.email,
        sn,
        email,
        user_id,
    )
    sn = (sn or "").strip()
    if not sn:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Device SN is required")

    target_user = None
    if user_id or email:
        target_user = await _resolve_target_user(current_account, mongo, email=email, user_id=user_id)

    device = await mongo.get_device_by_sn(sn)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    if not device.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Device is not assigned")

    if _is_admin(current_account):
        if target_user and str(device.user_id) != str(target_user.id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This device is not assigned to the specified user")

        if not target_user and device.admin_id and str(device.admin_id) != str(current_account.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot unassign devices outside your administration")

    else:
        if str(device.user_id) != str(current_account.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This device is not assigned to you")

    unassigned = await mongo.unassign_device(sn)
    if not unassigned:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to unassign device")

    logger.info("unbind_device_service completed actor=%s sn=%s", current_account.email, sn)
    return {"status": "ok", "device_sn": sn}
