from app.routers.auth import router as auth_router
from app.routers.devices import router as devices_router
from app.routers.location import router as location_router

__all__ = ["auth_router", "devices_router", "location_router"]

