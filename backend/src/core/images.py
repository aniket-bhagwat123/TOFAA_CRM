from src.core.errors import AppError

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024
UPLOAD_MAX_BYTES = 2 * 1024 * 1024  # profile and client photos (matches the Storage bucket limit)


def validate_image(content_type: str | None, data: bytes) -> None:
    if content_type not in ALLOWED_TYPES:
        raise AppError("Only JPEG, PNG or WebP images are allowed.")
    if len(data) > MAX_BYTES:
        raise AppError("Image must be 5 MB or smaller.", status_code=413)
    if not data:
        raise AppError("Image is empty.")


def sniff(data: bytes) -> tuple[str, str] | None:
    """Real type from the file's first bytes: (mime, extension). The browser's claim is not trusted."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def checked_upload(data: bytes) -> tuple[str, str]:
    """Validate an uploaded photo and return (mime, extension). Raises a friendly error otherwise."""
    if not data:
        raise AppError("The image is empty.", status_code=422)
    if len(data) > UPLOAD_MAX_BYTES:
        raise AppError("Image must be 2 MB or smaller.", status_code=413)
    kind = sniff(data)
    if not kind:
        raise AppError("Only JPEG, PNG or WebP images are allowed.", status_code=422)
    return kind
