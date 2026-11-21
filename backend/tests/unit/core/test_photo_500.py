from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.core.errors import register_error_handlers


def client_raising(exc):
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/boom")
    def boom():
        raise exc

    return TestClient(app, raise_server_exceptions=False)


def test_missing_photo_column_is_a_503_that_explains_itself():
    r = client_raising(Exception("{'message': 'column profiles.avatar_path does not exist', 'code': '42703'}")).get("/boom")
    assert r.status_code == 503 and "migration" in r.json()["message"]
    r = client_raising(Exception("column contacts.photo_path does not exist")).get("/boom")
    assert r.status_code == 503


def test_any_other_crash_is_still_a_plain_500():
    r = client_raising(RuntimeError("something else")).get("/boom")
    assert r.status_code == 500 and r.json()["message"] == "Something went wrong."
