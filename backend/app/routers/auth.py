from datetime import datetime, timezone
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from bson import ObjectId

from app.auth_utils import verify_password
from app.dependencies import (
    create_access_token,
    get_citytag_client,
    get_mongo_service,
    admin_to_public,
    user_to_public,
)
from app.models.admin import AdminCreate, AdminPublic
from app.models.user import UserCreate, UserPublic
from app.services.citytag import CityTagClient, CityTagError
from app.services.mongodb import MongoService


router = APIRouter(prefix="/api", tags=["auth"])
logger = logging.getLogger(__name__)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    uid: Optional[str] = None  # only needed for admin login


class LoginResponse(BaseModel):
    admin: Optional[AdminPublic] = None
    user: Optional["UserPublic"] = None
    role: str
    access_token: str
    token_type: str = "bearer"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
    citytag: Annotated[CityTagClient, Depends(get_citytag_client)],
):
    """
    Unified login endpoint for both admins and users.
    Admins must supply a UID and are authenticated via CityTag; users authenticate
    against the local database only.
    """
    logger.info("login started email=%s uid=%s", payload.email, payload.uid)

    # check admin first
    admin = await mongo.get_admin_by_email(payload.email)
    if admin:
        if not payload.uid:
            raise HTTPException(status_code=400, detail="UID required for admin login")

        # Try CityTag authentication first
        citytag_token = None
        try:
            citytag_data = await citytag.login(
                username=payload.email,
                password=payload.password,
            )
            logger.info("citytag_login success email=%s", payload.email)
            citytag_token = citytag_data.get("token")
            if not citytag_token:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="CityTag did not return a token",
                )
        except CityTagError as exc:
            logger.warning("citytag_login failed email=%s error=%s", payload.email, exc)
            logger.info("admin_login fallback_to_local_password email=%s", payload.email)
            if not verify_password(payload.password, admin.password):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid credentials",
                )
            logger.info("admin_login local_password_verified email=%s", payload.email)
            citytag_token = admin.citytag_token
            if not citytag_token:
                logger.warning("admin_login no_citytag_token_available email=%s", payload.email)

        # fetch devices for admin and persist to database
        reg_devices: list[str] = []
        devices_to_create: list[str] = []
        try:
            if citytag_token:
                devices = await citytag.get_devices(uid=payload.uid, token=citytag_token)
                logger.info("citytag_devices fetched email=%s count=%s", payload.email, len(devices))
                for d in devices:
                    if not isinstance(d, dict):
                        continue
                    sn = (
                        d.get("sn")
                        or d.get("deviceSn")
                        or d.get("deviceSN")
                        or d.get("serial")
                        or d.get("serialNumber")
                        or d.get("imei")
                        or d.get("device_no")
                        or d.get("deviceNo")
                    )
                    if sn and isinstance(sn, (str, int)):
                        sn_str = str(sn)
                        reg_devices.append(sn_str)
                        existing_device = await mongo.get_device_by_sn(sn_str)
                        if not existing_device:
                            devices_to_create.append(sn_str)
            else:
                logger.warning("citytag_devices skipped_no_token email=%s", payload.email)
        except Exception as exc:
            logger.exception("citytag_devices fetch_failed email=%s", payload.email)

        admin_data = AdminCreate(email=payload.email, password=payload.password, uid=payload.uid)
        admin = await mongo.create_or_update_admin(admin_data, citytag_token=citytag_token, reg_devices=reg_devices)
        logger.info("admin upserted email=%s admin_id=%s", payload.email, admin.id)

        for sn_str in devices_to_create:
            try:
                logger.info("admin_device creating email=%s sn=%s", payload.email, sn_str)
                await mongo.create_device(sn_str, str(admin.id), sn_str)
            except Exception as device_err:
                logger.exception("admin_device create_failed email=%s sn=%s", payload.email, sn_str)

        access_token = create_access_token(str(admin.id), "admin")
        return LoginResponse(admin=admin_to_public(admin), role="admin", access_token=access_token)

    # user login
    user = await mongo.get_user_by_email(payload.email)
    if not user or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    access_token = create_access_token(str(user.id), "user")
    logger.info("user login completed email=%s user_id=%s", payload.email, user.id)
    return LoginResponse(user=user_to_public(user), role="user", access_token=access_token)


# FIX 1: removed `response_model=UserPublic` — we now return a custom dict
#         with access_token + user so SignupForm can call loginSuccess() and
#         redirect immediately. Previously returned UserPublic which has neither.
@router.post("/register")
async def register(
    payload: RegisterRequest,
    mongo: Annotated[MongoService, Depends(get_mongo_service)],
):
    """Create a new user account (role=user), auto-login on success."""
    logger.info("register started email=%s", payload.email)
    existing = await mongo.get_user_by_email(payload.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    name = (payload.name or "").strip()
    user = await mongo.create_user(payload.email, payload.password, name)

    # FIX 2: explicitly stamp name + created_at on the doc.
    # create_user() may not write these fields depending on its implementation.
    await mongo.users.update_one(
        {"_id": ObjectId(str(user.id))},
        {"$set": {
            "name":       name,
            "created_at": datetime.now(timezone.utc),
        }},
    )

    access_token = create_access_token(str(user.id), "user")
    logger.info("register completed email=%s user_id=%s", payload.email, user.id)
    return {
        "access_token": access_token,
        "role":         "user",
        "user": {
            "id":    str(user.id),
            "email": user.email,
            "name":  name,
        },
    }