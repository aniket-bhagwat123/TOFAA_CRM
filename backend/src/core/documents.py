"""Uploaded documents: minutes of meeting and signed agreements. Checked by the file's real bytes."""
from src.core.errors import AppError

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
LABEL = "Upload a PDF, Word (.docx) or image (JPEG, PNG, WebP) file, 10 MB or smaller."


def sniff_document(data: bytes) -> tuple[str, str] | None:
    if data[:5] == b"%PDF-":
        return "application/pdf", "pdf"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    if data[:4] == b"PK\x03\x04":  # a zip container: only .docx is accepted, decided by the name below
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"
    return None


def checked_document(data: bytes, filename: str | None = None) -> tuple[str, str]:
    if not data:
        raise AppError("The file is empty.", status_code=422)
    if len(data) > MAX_DOCUMENT_BYTES:
        raise AppError("The file must be 10 MB or smaller.", status_code=413)
    kind = sniff_document(data)
    if not kind:
        raise AppError(LABEL, status_code=422)
    if kind[1] == "docx" and not (filename or "").lower().endswith(".docx"):
        raise AppError(LABEL, status_code=422)  # a zip that is not named .docx (could be anything)
    return kind
