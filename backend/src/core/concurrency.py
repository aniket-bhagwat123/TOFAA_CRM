from src.core.errors import ConflictError


def check_version(current: dict, expected_version: int) -> None:
    """Optimistic locking: raise 409 with the latest copy if the client is stale."""
    if current.get("version") != expected_version:
        raise ConflictError("This record was changed by someone else.", data={"latest": current})
