import pytest

from src.core import cache, storage
from src.core.errors import AppError
from src.core.images import UPLOAD_MAX_BYTES, checked_upload, sniff

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 20
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"0" * 20


def test_real_type_comes_from_the_bytes():
    assert sniff(JPEG) == ("image/jpeg", "jpg")
    assert sniff(PNG) == ("image/png", "png")
    assert sniff(WEBP) == ("image/webp", "webp")
    assert sniff(b"<html><script>alert(1)</script>") is None


def test_checked_upload_rejects_fakes_empty_and_big():
    assert checked_upload(PNG)[1] == "png"
    for bad in (b"", b"<svg onload=alert(1)>", b"GIF89a" + b"0" * 10):
        with pytest.raises(AppError):
            checked_upload(bad)
    with pytest.raises(AppError) as e:
        checked_upload(JPEG + b"0" * UPLOAD_MAX_BYTES)
    assert e.value.status_code == 413


class FakeBucket:
    def __init__(self):
        self.signed = []

    def create_signed_urls(self, paths, seconds):
        self.signed.append(list(paths))
        return [{"path": p, "signedURL": f"https://x/{p}?t=1", "error": None} for p in paths]


def test_signed_urls_are_batched_and_cached(monkeypatch):
    cache.clear()
    bucket = FakeBucket()
    db = type("Db", (), {"storage": type("S", (), {"from_": lambda self, b: bucket})()})()
    monkeypatch.setattr(storage, "get_service_client", lambda: db)
    first = storage.signed_urls("avatars", ["a/1.jpg", "a/2.jpg", None, "a/1.jpg"])
    assert set(first) == {"a/1.jpg", "a/2.jpg"} and len(bucket.signed) == 1  # one request for both
    storage.signed_urls("avatars", ["a/1.jpg", "a/2.jpg"])
    assert len(bucket.signed) == 1  # second time: from memory
    storage.signed_urls("avatars", ["a/1.jpg", "a/3.jpg"])
    assert bucket.signed[-1] == ["a/3.jpg"]  # only the new one is signed


def test_a_failing_storage_never_breaks_the_caller(monkeypatch):
    cache.clear()

    class Broken:
        def from_(self, b):
            raise RuntimeError("storage down")

    monkeypatch.setattr(storage, "get_service_client", lambda: type("Db", (), {"storage": Broken()})())
    assert storage.signed_urls("avatars", ["a/1.jpg"]) == {}
