import os

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret-test-secret-test-secret-32")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _default_app_settings(monkeypatch):
    """Unit tests use the built-in settings (lost reasons, sources, retry rules), never the database."""
    from src.core import app_settings

    monkeypatch.setattr(app_settings, "all_settings", lambda: {k: v for k, v in app_settings.DEFAULTS.items()})
