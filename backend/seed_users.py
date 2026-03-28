# seed_data.py
import asyncio
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from app.auth_utils import hash_password


# use a dedicated development database and drop existing data each run
DB_NAME = os.getenv("SEED_DB_NAME", "citytag_development")


# initial administrator account(s) -- these are the company admins who own all devices
SEED_ADMINS = [
    {
        "email": "walishajeeh66@gmail.com",
        "password": "Trakker123",
        "uid": "251527",
    },
    {
        "email": "abdulsaboornaeem@gmail.com",
        "password": "Trakker123",
        "uid": "251799",
    },
]

# demo user accounts (will be linked to admin when they add a device)
SEED_USERS = [
    {"email": "user1@example.com", "password": "userpass", "name": "Alice"},
    {"email": "user2@example.com", "password": "userpass", "name": "Bob"},
]


async def main() -> None:
    here = os.path.dirname(__file__)
    load_dotenv(dotenv_path=os.path.join(here, ".env"))

    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/" + DB_NAME)
    client = AsyncIOMotorClient(mongo_uri)

    # drop existing database to start fresh (development only)
    print(f"Dropping database '{DB_NAME}' (if it exists)...")
    client.drop_database(DB_NAME)

    db = client[DB_NAME]

    # ────────────────────────────────────────────────
    # Seed admins and users collections
    # ────────────────────────────────────────────────

    now = datetime.now(timezone.utc)

    admins = db["admins"]
    users = db["users"]
    devices = db["devices"]

    print("Seeding admin accounts...")
    for a in SEED_ADMINS:
        await admins.update_one(
            {"email": a["email"]},
            {
                "$setOnInsert": {"email": a["email"], "created_at": now},
                "$set": {"password": hash_password(a["password"]), "uid": a["uid"], "reg_devices": []},
            },
            upsert=True,
        )
    print(f"Admins count after seed: {await admins.count_documents({})}")

    print("Seeding demo user accounts (unlinked)")
    for u in SEED_USERS:
        await users.update_one(
            {"email": u["email"]},
            {
                "$setOnInsert": {"email": u["email"], "created_at": now, "role": "user"},
                "$set": {"password": hash_password(u["password"]), "name": u.get("name", ""), "admin_id": None, "devices": []},
            },
            upsert=True,
        )
    print(f"Users count after seed: {await users.count_documents({})}")

    # ────────────────────────────────────────────────
    # Create / ensure locations and devices collections + indexes
    # ────────────────────────────────────────────────

    locations = db["locations"]
    print("\nEnsuring indexes on locations collection...")

    print("\nEnsuring indexes on devices collection...")
    await devices.create_index([("admin_id", 1)], name="admin_idx", background=True)
    await devices.create_index([("user_id", 1)], name="user_idx", background=True)
    await devices.create_index([("sn", 1)], name="sn_idx", unique=True, background=True)

    # Primary index: fast queries by user + device + time range
    await locations.create_index(
        [("uid", 1), ("sn", 1), ("timestamp", 1)],
        name="uid_sn_timestamp_asc",
        background=True
    )

    # Optional: fast sort by most recent first
    await locations.create_index(
        [("timestamp", -1)],
        name="timestamp_desc",
        background=True
    )

    print("Indexes created (or already exist):")
    indexes = await locations.index_information()
    for name, info in indexes.items():
        print(f"  - {name}: {info['key']}")

    # ────────────────────────────────────────────────
    # Insert a few dummy location records (for quick testing)
    # You can comment this block out after the first run
    # ────────────────────────────────────────────────

    print("\nInserting 3 dummy location records (for testing trajectory/playback)...")

    dummy_data = [
        {
            "uid": "251527",
            "sn": "TEST_DEV_001",
            "timestamp": now - timedelta(hours=2),
            "lat": 24.8607,
            "lng": 67.0012
        },
        {
            "uid": "251527",
            "sn": "TEST_DEV_001",
            "timestamp": now - timedelta(hours=1, minutes=30),
            "lat": 24.8615,
            "lng": 67.0028
        },
        {
            "uid": "251800",
            "sn": "TEST_DEV_002",
            "timestamp": now - timedelta(hours=3),
            "lat": 24.8580,
            "lng": 66.9985
        }
    ]

    await locations.insert_many(dummy_data)
    print(f"Inserted {len(dummy_data)} dummy records")

    total_locations = await locations.count_documents({})
    print(f"Total documents in locations now: {total_locations}")

    # Quick preview of inserted data
    recent = await locations.find().sort("timestamp", -1).limit(3).to_list(3)
    print("\nMost recent 3 dummy points:")
    for doc in recent:
        print(f"  - {doc['timestamp']} | uid={doc['uid']} | sn={doc['sn']} | lat={doc['lat']}, lng={doc['lng']}")

    client.close()
    print("\nSeed & index creation complete.")


if __name__ == "__main__":
    asyncio.run(main())