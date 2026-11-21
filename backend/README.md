# TOFAA CRM Backend

FastAPI service. REST API under `/api/v1`.

```powershell
cd backend
copy .env.example .env   # fill in Supabase values
uv sync
uv run uvicorn src.main:app --reload --port 8000
uv run pytest
```

Docs: http://localhost:8000/api/v1/docs (disabled when `ENVIRONMENT=production`).
See `../PROJECT_STRUCTURE.md` for the module pattern.
