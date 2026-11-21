import pytest

from src.core import storage
from src.core.errors import AppError


class Bucket:
    def __init__(self, error=None):
        self.error, self.removed = error, []

    def upload(self, path, data, opts):
        if self.error:
            raise self.error

    def remove(self, paths):
        self.removed.extend(paths)


def fake_db(bucket):
    return type("Db", (), {"storage": type("S", (), {"from_": lambda self, b: bucket})()})()


def test_missing_bucket_says_what_to_do(monkeypatch):
    monkeypatch.setattr(storage, "get_service_client", lambda: fake_db(Bucket(Exception("{'error': Bucket not found}"))))
    with pytest.raises(AppError) as e:
        storage.upload_image("avatars", "u1", b"x", "image/png", "png")
    assert e.value.status_code == 503 and "migration" in e.value.message


def test_other_upload_failures_stay_generic(monkeypatch):
    monkeypatch.setattr(storage, "get_service_client", lambda: fake_db(Bucket(Exception("timeout"))))
    with pytest.raises(AppError) as e:
        storage.upload_image("avatars", "u1", b"x", "image/png", "png")
    assert e.value.status_code == 502


def test_missing_column_removes_the_uploaded_file_and_explains(monkeypatch):
    bucket = Bucket()
    monkeypatch.setattr(storage, "get_service_client", lambda: fake_db(bucket))
    monkeypatch.setattr(storage, "bg", lambda fn, *a, **k: fn(*a, **k))  # run the clean-up now

    def write():
        raise Exception("{'message': 'column profiles.avatar_path does not exist', 'code': '42703'}")

    with pytest.raises(AppError) as e:
        storage.guard_photo_write("avatars", "u1/a.png", write)
    assert e.value.status_code == 503 and "migration" in e.value.message
    assert bucket.removed == ["u1/a.png"]
