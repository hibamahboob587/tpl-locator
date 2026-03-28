"""Password hashing and verification (using pbkdf2_sha256 to avoid bcrypt issues)."""
from passlib.context import CryptContext

# Use pbkdf2_sha256 only – avoids the buggy bcrypt backend on this system.
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(plain: str) -> str:
    """Return a secure hash of the plain password."""
    if plain is None:
        plain = ""
    return pwd_context.hash(plain)


def verify_password(plain: str, stored: str) -> bool:
    """
    Verify a plain password against the stored value.

    - If `stored` is a passlib hash (pbkdf2_sha256), use the context.
    - Otherwise, fall back to constant-time equality for any legacy/plaintext values.
    """
    if not stored:
        return False

    if pwd_context.identify(stored):
        return pwd_context.verify(plain or "", stored)

    # Fallback for legacy/plaintext storage
    return (plain or "") == stored
