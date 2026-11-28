"""Write oms-handover.openapi.json: only the APIs the OMS calls, to hand to the OMS team.

Run from backend/:  python scripts/export_oms_openapi.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI  # noqa: E402
from fastapi.openapi.utils import get_openapi  # noqa: E402

from src.core.config import settings  # noqa: E402
from src.modules.orders.oms_api import router  # noqa: E402

app = FastAPI()
app.include_router(router, prefix=settings.API_V1_STR)
document = get_openapi(title="TOFAA CRM: OMS Handover API", version="1.0.0", routes=app.routes,
                       description="The OMS reads approved handovers and sends its stage back. See OMS_ORDER_API.md.")
target = ROOT / "oms-handover.openapi.json"
target.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {target.name}: {', '.join(document['paths'])}")
