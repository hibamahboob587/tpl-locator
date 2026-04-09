# api/run_sync.py

import asyncio
from datetime import datetime

from app.services.auto_sync import sync_all_users

def main():
    start = datetime.utcnow()
    print(f"[{start.isoformat()}] Starting sync (cron / manual run)")
    
    try:
        asyncio.run(sync_all_users())
    except Exception as e:
        print(f"Sync failed: {type(e).__name__}: {e}")
        raise  # optional — remove if you want silent failure
    
    end = datetime.utcnow()
    print(f"[{end.isoformat()}] Sync finished in {(end - start).total_seconds():.1f} seconds")

if __name__ == "__main__":
    main()