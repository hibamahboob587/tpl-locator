from datetime import datetime, timezone
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from bson import ObjectId

from app.auth_utils import verify_password
from app.dependencies import (
    create_access_token,
    get_mongo_service,
    admin_to_public,
    user_to_public,
)
from app.models.admin import AdminCreate, AdminPublic
from app.models.user import UserCreate, UserPublic
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
):
    """
    Unified login endpoint for both admins and users.

    Admin authentication is purely local (Mongo) to keep login stable.
    CityTag interactions (token refresh + device/location sync) are handled by /sync endpoints.
    """
    logger.info("login started email=%s uid=%s", payload.email, payload.uid)

    # check admin first
    admin = await mongo.get_admin_by_email(payload.email)
    if admin:
        if not payload.uid:
            raise HTTPException(status_code=400, detail="UID required for admin login")

        # Local authentication only
        if not verify_password(payload.password, admin.password):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        # Upsert admin doc (without forcing CityTag token/device refresh)
        admin_data = AdminCreate(email=payload.email, password=payload.password, uid=payload.uid)
        admin = await mongo.create_or_update_admin(admin_data)
        logger.info("admin upserted email=%s admin_id=%s", payload.email, admin.id)

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