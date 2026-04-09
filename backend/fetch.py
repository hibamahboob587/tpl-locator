from pymongo import MongoClient
from dotenv import load_dotenv
import os

# ── Config ───────────────────────────────────────────────────────────────────
load_dotenv()
MONGO_URI   = os.getenv("MONGO_URI")
DATABASE    = "citytag_development"
SAMPLE_SIZE = 10
# ─────────────────────────────────────────────────────────────────────────────

if not MONGO_URI or not DATABASE:
    raise ValueError("Missing MONGO_URI or MONGO_DATABASE in .env file")


def infer_type(value):
    if isinstance(value, dict):
        return {k: infer_type(v) for k, v in value.items()}
    elif isinstance(value, list):
        return f"Array<{infer_type(value[0])}>" if value else "Array<unknown>"
    else:
        return type(value).__name__


def merge_schemas(base, new):
    for key, val in new.items():
        if key not in base:
            base[key] = val
        elif isinstance(base[key], dict) and isinstance(val, dict):
            merge_schemas(base[key], val)
        elif base[key] != val:
            base[key] = f"{base[key]} | {val}"
    return base


def infer_collection_schema(collection):
    schema = {}
    for doc in collection.find().limit(SAMPLE_SIZE):
        doc.pop("_id", None)
        schema = merge_schemas(schema, infer_type(doc))
    return schema


def print_schema(schema, indent=0):
    pad = "  " * indent
    if isinstance(schema, dict):
        for key, val in schema.items():
            if isinstance(val, dict):
                print(f"{pad}  {key}:")
                print_schema(val, indent + 2)
            else:
                print(f"{pad}  {key}: {val}")
    else:
        print(f"{pad}  {schema}")


def main():
    client = MongoClient(MONGO_URI)
    db     = client[DATABASE]

    collections = db.list_collection_names()

    print(f"\n{'═' * 55}")
    print(f"  Database    : {DATABASE}")
    print(f"  Collections : {len(collections)}")
    print(f"{'═' * 55}\n")

    for col_name in collections:
        collection = db[col_name]
        doc_count  = collection.count_documents({})
        schema     = infer_collection_schema(collection)

        print(f"┌─ Collection : {col_name}")
        print(f"│  Total docs : {doc_count}")
        print(f"│  Schema (sampled from up to {SAMPLE_SIZE} docs):")
        print(f"│")
        if schema:
            print_schema(schema, indent=1)
        else:
            print("│    (empty collection)")
        print(f"└{'─' * 50}\n")

    client.close()


if __name__ == "__main__":
    main()