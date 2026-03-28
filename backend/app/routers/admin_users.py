from datetime import datetime, timezone
import logging
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from bson import ObjectId

from app.dependencies import get_current_admin, get_mongo_service
from app.models.admin import AdminInDB
from app.services.mongodb import MongoService
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin_users"])


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str
    name: str = ""


def _to_oid(value) -> Optional[ObjectId]:
    if value is None:
        return None
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except Exception:
        return None


async def _clear_binding(mongo: MongoService, sn: str) -> None:
    """
    Atomically wipe ALL binding fields from a device doc via $unset.
    This ensures name/client/bound_at don't linger as stale data after unbind.
    """
    await mongo.devices.update_one(
        {"sn": sn},
        {"$unset": {
            "user_id":  "",
            "name":     "",
            "client":   "",
            "bound_at": "",
        }},
    )


async def _populate_devices(mongo: MongoService, device_ids: list) -> list:
    populated = []
    for d_id in device_ids:
        try:
            oid = d_id if isinstance(d_id, ObjectId) else ObjectId(str(d_id))
            device_doc = await mongo.devices.find_one({"_id": oid})
            if device_doc:
                populated.append({
                    "id":   str(device_doc["_id"]),
                    "sn":   device_doc.get("sn", str(oid)),
                    "name": device_doc.get("name", ""),
                })
            else:
                populated.append({"id": str(d_id), "sn": str(d_id), "name": ""})
        except Exception as err:
            logger.exception("populate_devices failed device_id=%s", d_id)
            populated.append({"id": str(d_id), "sn": str(d_id), "name": ""})
    return populated


@router.post("/users")
async def admin_create_user(
    payload: CreateUserRequest,
    current_admin: Annotated[AdminInDB, Depends(get_current_admin)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    logger.info("admin_create_user started admin=%s email=%s", current_admin.email, payload.email)
    try:
        existing = await mongo.get_user_by_email(payload.email)
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

        user = await mongo.create_user(payload.email, payload.password, payload.name)
        created_at = datetime.now(timezone.utc)
        await mongo.users.update_one(
            {"_id": ObjectId(str(user.id))},
            {"$set": {"created_at": created_at}},
        )
        await mongo.update_user_admin(str(user.id), str(current_admin.id))
        updated = await mongo.get_user_by_id(str(user.id))
        devices = await _populate_devices(mongo, updated.devices or [])
        response = {
            "id":         str(updated.id),
            "email":      updated.email,
            "name":       updated.name,
            "admin_id":   str(updated.admin_id) if updated.admin_id else None,
            "devices":    devices,
            "created_at": created_at.isoformat(),
        }
        logger.info("admin_create_user completed admin=%s user_id=%s", current_admin.email, response["id"])
        return response
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("admin_create_user failed admin=%s email=%s", current_admin.email, payload.email)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err))


@router.get("/users")
async def admin_list_users(
    current_admin: Annotated[AdminInDB, Depends(get_current_admin)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
) -> List[dict]:
    logger.info("admin_list_users started admin=%s", current_admin.email)
    try:
        admin_id_obj = _to_oid(current_admin.id)
        users_cursor = mongo.users.find({
            "$or": [
                {"admin_id": admin_id_obj},
                {"admin_id": None},
                {"admin_id": {"$exists": False}},
            ]
        })
        user_dicts = await users_cursor.to_list(None)

        result = []
        for user_dict in user_dicts:
            raw_devices = user_dict.get("devices", [])
            devices = await _populate_devices(mongo, raw_devices)
            created_at = user_dict.get("created_at")
            if not created_at:
                try:
                    created_at = user_dict["_id"].generation_time.isoformat()
                except Exception:
                    created_at = None
            elif isinstance(created_at, datetime):
                created_at = created_at.isoformat()
            result.append({
                "id":         str(user_dict.get("_id", "")),
                "email":      user_dict.get("email", ""),
                "name":       user_dict.get("name", ""),
                "admin_id":   str(user_dict.get("admin_id", "")) if user_dict.get("admin_id") else None,
                "devices":    devices,
                "created_at": created_at,
            })
        logger.info("admin_list_users completed admin=%s count=%s", current_admin.email, len(result))
        return result
    except Exception as err:
        logger.exception("admin_list_users failed admin=%s", current_admin.email)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to list users: {str(err)}")


@router.delete("/users/{user_id}")
async def admin_delete_user(
    user_id: str,
    current_admin: Annotated[AdminInDB, Depends(get_current_admin)],
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    logger.info("admin_delete_user started admin=%s target_user_id=%s", current_admin.email, user_id)
    user = await mongo.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.admin_id and str(user.admin_id) != str(current_admin.id):
        raise HTTPException(status_code=403, detail="You do not manage this user")
    deleted = await mongo.delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete user")
    logger.info("admin_delete_user completed admin=%s target_user_id=%s", current_admin.email, user_id)
    return {"status": "ok"}