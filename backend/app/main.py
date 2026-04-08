import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.auth import router as auth_router
from app.routers.devices import router as devices_router
from app.routers.location import router as location_router
from app.routers.history import router as history_router
from app.routers.sync import router as sync_router
from app.services.auto_sync import start_auto_sync_tasks


def create_app() -> FastAPI:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    app = FastAPI(title="CityTag Tracking Dashboard API")

    # CORS for local development – adjust origins as needed
    app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],           
    allow_credentials=False,       
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    )

    app.include_router(auth_router)
    app.include_router(devices_router)
    # admin-specific endpoints
    from app.routers.admin_devices import router as admin_devices_router
    from app.routers.admin_users import router as admin_users_router
    app.include_router(admin_devices_router)
    app.include_router(admin_users_router)
    app.include_router(location_router)
    app.include_router(history_router)
    app.include_router(sync_router)

    from app.routers.field_staff import router as field_staff_router
    app.include_router(field_staff_router)
    
    start_auto_sync_tasks(app)

    

    @app.get("/health")
    async def health_check():
        return {"status": "ok"}

    return app


app = create_app()

