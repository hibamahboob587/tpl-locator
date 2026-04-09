import argparse
import asyncio
import os
import sys
from datetime import datetime, time as dt_time, timedelta

import pandas as pd
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

DEFAULT_FILE = "CardTagReadings_Fixed.xlsx"
ADMIN_UID    = os.getenv("CITYTAG_UID", "251799")
MONGO_URI    = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME      = os.getenv("MONGO_DB_NAME", "citytag_development")
COLLECTION   = "locations"

# Expected date range for validation — used to detect Excel MM/DD swaps
# *** FIXED: Tightened to actual data range so swap triggers correctly ***
# Old: datetime(2026, 2, 1)  → Feb 3 fell inside, swap never triggered
# Old: datetime(2026, 3, 31) → too loose
RANGE_START = datetime(2026, 2, 16)
RANGE_END   = datetime(2026, 3, 7)


def _try_swap_month_day(dt: datetime) -> datetime | None:
    """Swap month and day if valid. Returns None if the swap produces an invalid date."""
    try:
        return dt.replace(month=dt.day, day=dt.month)
    except ValueError:
        return None


def parse_date_robust(date_val) -> str | None:
    """
    Parse a date value to YYYY-MM-DD string, handling the Excel MM/DD vs DD/MM ambiguity.

    The problem: Excel auto-parses date cells into datetime objects using the system
    locale. On MM/DD systems, '01/03/2026' (1st March) becomes datetime(2026,1,3).
    When pandas reads this with dtype=str it becomes '2026-01-03 00:00:00' — wrong.

    Fix: after parsing, check if the date falls outside the expected range. If it does
    AND swapping month/day puts it inside the range, use the swapped date.
    """
    if not isinstance(date_val, str) and pd.isna(date_val):
        return None

    date_str = str(date_val).strip()

    # Already a full datetime string from openpyxl pre-parsing e.g. "2026-01-03 00:00:00"
    parsed = None
    if len(date_str) >= 10 and date_str[:4].isdigit() and date_str[4] == '-':
        try:
            parsed = datetime.strptime(date_str[:10], "%Y-%m-%d")
        except ValueError:
            pass

    # String date in DD/MM/YYYY format e.g. "16/02/2026"
    if parsed is None:
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y"):
            try:
                parsed = datetime.strptime(date_str, fmt)
                break
            except ValueError:
                continue

    if parsed is None:
        return None

    # If the parsed date is outside expected range, try swapping month/day
    # This corrects Excel's MM/DD mis-parsing of ambiguous dates like "01/03/2026"
    if not (RANGE_START <= parsed <= RANGE_END):
        swapped = _try_swap_month_day(parsed)
        if swapped and RANGE_START <= swapped <= RANGE_END:
            parsed = swapped

    return parsed.strftime("%Y-%m-%d")


def parse_sheet(xl: pd.ExcelFile, sheet: str) -> list[dict]:
    # dtype=str prevents pandas from re-parsing cells, though openpyxl may have
    # already converted some date cells to datetime objects before we see them
    df = xl.parse(sheet, header=1, dtype=str)

    if len(df.columns) == 5:
        df.columns = ["date", "time", "lat", "lng", "landmark"]
    elif len(df.columns) == 4:
        df.columns = ["date", "time", "latlong", "landmark"]
    else:
        print(f"  [SKIP] {sheet} unexpected column count: {len(df.columns)}")
        return []

    sn   = f"CARD-{sheet}"
    docs = []

    for _, row in df.iterrows():
        date_raw = row.get("date", "")
        time_raw = row.get("time", "")

        if pd.isna(date_raw) if not isinstance(date_raw, str) else not str(date_raw).strip():
            continue
        if pd.isna(time_raw) if not isinstance(time_raw, str) else not str(time_raw).strip():
            continue

        # --- Parse date ---
        date_part = parse_date_robust(date_raw)
        if not date_part:
            print(f"  [WARN] {sheet} could not parse date, skipping: {date_raw!r}")
            continue

        # --- Parse time ---
        time_str = str(time_raw).strip()
        if ":" not in time_str:
            try:
                # Excel stores time as a fraction of a day (float)
                frac  = float(time_str)
                total = int(round(frac * 86400))
                h, rem = divmod(total, 3600)
                m, s   = divmod(rem, 60)
                time_str = f"{h:02d}:{m:02d}:{s:02d}"
            except ValueError:
                print(f"  [WARN] {sheet} could not parse time, skipping: {time_raw!r}")
                continue
        else:
            parts = time_str.split(":")
            if len(parts) == 2:
                time_str = f"{int(parts[0]):02d}:{parts[1]}:00"
            elif len(parts) >= 3:
                time_str = f"{int(parts[0]):02d}:{parts[1]}:{parts[2][:2]}"

        # --- Combine into timestamp ---
        ts_str = f"{date_part} {time_str}"
        try:
            timestamp = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            try:
                timestamp = pd.to_datetime(ts_str, errors="raise").to_pydatetime()
            except Exception:
                print(f"  [WARN] {sheet} bad timestamp, skipping: {ts_str!r}")
                continue

        # --- Parse lat/lng ---
        def extract_float(val):
            val = str(val).strip()
            try:
                return float(val)
            except ValueError:
                pass
            try:
                from datetime import datetime as _dt
                dt = _dt.strptime(val[:19], "%Y-%m-%d %H:%M:%S")
                excel_epoch = _dt(1899, 12, 30)
                days = (dt.date() - excel_epoch.date()).days
                time_frac = (dt.hour * 3600 + dt.minute * 60 + dt.second) / 86400
                return days + time_frac
            except ValueError:
                raise ValueError(f"could not convert to float: {val!r}")

        try:
            if "lat" in df.columns and "lng" in df.columns:
                lat = extract_float(row["lat"])
                lng = extract_float(row["lng"])
            else:
                lat, lng = [float(x.strip()) for x in str(row["latlong"]).split(",")]
        except Exception as e:
            print(f"  [SKIP] {sheet} bad coords: {e} | row: {row.to_dict()}")
            continue

        if lat == 0 or lng == 0:
            continue

        docs.append({
            "uid":       ADMIN_UID,
            "sn":        sn,
            "timestamp": timestamp,
            "lat":       lat,
            "lng":       lng,
            "speed":     None,
            "heading":   None,
            "accuracy":  None,
            "altitude":  None,
        })

    return docs


async def filter_duplicates(col, docs: list[dict]) -> tuple[list[dict], int]:
    if not docs:
        return [], 0

    sns_in_batch        = list({d["sn"] for d in docs})
    timestamps_in_batch = [d["timestamp"] for d in docs]

    existing = await col.find(
        {
            "sn":        {"$in": sns_in_batch},
            "timestamp": {"$in": timestamps_in_batch},
        },
        {"sn": 1, "timestamp": 1, "_id": 0}
    ).to_list(length=None)

    existing_keys = {(e["sn"], e["timestamp"]) for e in existing}
    new_docs      = [d for d in docs if (d["sn"], d["timestamp"]) not in existing_keys]
    duplicates    = len(docs) - len(new_docs)

    return new_docs, duplicates


async def run(filepath: str, apply: bool):
    if not os.path.exists(filepath):
        print(f"[ERROR] File not found: {filepath}")
        sys.exit(1)

    xl       = pd.ExcelFile(filepath)
    all_docs = []

    print(f"\nFile    : {filepath}")
    print(f"Sheets  : {xl.sheet_names}")
    print(f"UID     : {ADMIN_UID}")
    print(f"MongoDB : {MONGO_URI}  db={DB_NAME}  col={COLLECTION}\n")

    for sheet in xl.sheet_names:
        docs = parse_sheet(xl, sheet)
        print(f"  CARD-{sheet:<6}  {len(docs)} points")
        all_docs.extend(docs)

    print(f"\nTotal   : {len(all_docs)} documents prepared")

    if not apply:
        print("\nDry run — pass --apply to write to MongoDB\n")
        return

    print("\nConnecting to MongoDB…")
    client = AsyncIOMotorClient(MONGO_URI)
    col    = client[DB_NAME][COLLECTION]

    print("Checking for duplicates…")
    new_docs, duplicate_count = await filter_duplicates(col, all_docs)

    print(f"  Already in DB : {duplicate_count}")
    print(f"  New to insert : {len(new_docs)}")

    if not new_docs:
        print("\nNothing new to insert — all records already exist in DB.\n")
        client.close()
        return

    result = await col.insert_many(new_docs, ordered=False)
    client.close()
    print(f"\nDone — {len(result.inserted_ids)} inserted, {duplicate_count} duplicates skipped.\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--file",  default=DEFAULT_FILE)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    asyncio.run(run(args.file, args.apply))