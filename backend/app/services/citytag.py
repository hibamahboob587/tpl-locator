# CityTag API integration
# https://www.citytag.cn/
# 
import base64
import json
from typing import Any, Dict, List, Optional
from datetime import datetime
import httpx
from Crypto.Cipher import DES3
from Crypto.Util.Padding import pad, unpad

BLOCK_SIZE = 8  # 3DES block size in bytes


class CityTagError(Exception):
    """Raised when CityTag API returns an error."""


def _build_3des_key(token: str) -> bytes:
    """Build a valid 3DES key from the CityTag token."""
    key = token.encode("utf-8")
    if len(key) not in (16, 24):
        key = (key + b"0" * 24)[:24]
    return DES3.adjust_key_parity(key)


def encrypt_payload(payload: Dict[str, Any], token: str) -> str:
    """Encrypt JSON payload using 3DES-ECB with PKCS7 padding."""
    key = _build_3des_key(token)
    cipher = DES3.new(key, DES3.MODE_ECB)
    plaintext = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    padded = pad(plaintext, BLOCK_SIZE)
    encrypted = cipher.encrypt(padded)
    return base64.b64encode(encrypted).decode("utf-8")


def decrypt_payload(ciphertext: str, token: str) -> Dict[str, Any]:
    """Decrypt CityTag response 'data' field using 3DES-ECB PKCS7."""
    key = _build_3des_key(token)
    cipher = DES3.new(key, DES3.MODE_ECB)
    raw = base64.b64decode(ciphertext)
    padded = cipher.decrypt(raw)
    plaintext = unpad(padded, BLOCK_SIZE)
    return json.loads(plaintext.decode("utf-8"))


class CityTagClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    async def login(self, username: str, password: str) -> Dict[str, Any]:
        """Call CityTag login endpoint (no encryption)."""
        url = f"{self.base_url}/api/interface/login"
        data = {"username": username, "password": password}
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        resp.raise_for_status()
        body = resp.json()
        if body.get("code") != "00000":
            raise CityTagError(body.get("msg") or "CityTag login failed")
        return body["data"]

    async def get_devices(self, uid: str, token: str, sn: Optional[str] = None, page_no: int = 1, page_size: int = 20) -> List[Dict[str, Any]]:
        """Get list of devices for a user via encrypted payload."""
        url = f"{self.base_url}/api2/v4/device/{uid}"
        payload: Dict[str, Any] = {"pageNo": page_no, "pageSize": page_size}
        if sn:
            payload["sn"] = sn
        encryption = encrypt_payload(payload, token)
        body = {"encryption": encryption}
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json=body)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "00000":
            raise CityTagError(data.get("msg") or "CityTag device list failed")
        encrypted_data = data.get("data")
        if not encrypted_data:
            return []

        decrypted = decrypt_payload(encrypted_data, token)

        # Common response shapes:
        # - {"list": [...]} or {"devices": [...]}
        # - {"data": {"list": [...]}} (nested)
        # - or directly a list
        if isinstance(decrypted, dict):
            # Direct keys we know about.
            for key in ("list", "devices"):
                value = decrypted.get(key)
                if isinstance(value, list):
                    return value

            # If there's a nested dict under "data", look for a list there.
            inner = decrypted.get("data")
            if isinstance(inner, dict):
                for value in inner.values():
                    if isinstance(value, list):
                        return value

            # Fallback: any list value inside the top-level dict.
            for value in decrypted.values():
                if isinstance(value, list):
                    return value

        if isinstance(decrypted, list):
            return decrypted

        return []

    async def get_latest_location(self, uid: str, token: str, sn: str, page_no: int = 1, page_size: int = 20) -> Optional[Dict[str, Any]]:
        """Get latest location for a specific device SN."""
        url = f"{self.base_url}/api/interface/v2/device/{uid}"
        payload = {"uid": int(uid), "sn": sn, "pageNo": page_no, "pageSize": page_size}
        encryption = encrypt_payload(payload, token)
        body = {"encryption": encryption}
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json=body)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "00000":
            raise CityTagError(data.get("msg") or "CityTag trajectory failed")
        encrypted_data = data.get("data")
        if not encrypted_data:
            return None
        decrypted = decrypt_payload(encrypted_data, token)
        history = decrypted.get("history") or []
        return history[-1] if history else None

    async def get_location_history(self, uid: str, token: str, sn: str, start_time: datetime, end_time: datetime, page_no: int = 1, page_size: int = 500) -> list[dict]:
        """Fetch location history for a device in a time range."""
        url = f"{self.base_url}/api/interface/v2/device/{uid}"
        payload = {
            "uid": int(uid),
            "sn": sn,
            "pageNo": page_no,
            "pageSize": page_size,
            "beginTime": int(start_time.timestamp() * 1000),
            "endTime": int(end_time.timestamp() * 1000),
        }
        encryption = encrypt_payload(payload, token)
        body = {"encryption": encryption}
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(url, json=body)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "00000":
            raise CityTagError(data.get("msg") or "Failed to fetch location history")
        encrypted_data = data.get("data")
        if not encrypted_data:
            return []
        decrypted = decrypt_payload(encrypted_data, token)
        return decrypted.get("history", [])
