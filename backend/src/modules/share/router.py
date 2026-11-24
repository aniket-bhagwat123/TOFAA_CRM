"""The public end of short links (/s/<code>): no sign-in, the code is the key. See core/share_links.py."""
from urllib.parse import quote

from fastapi import APIRouter, Response
from starlette.concurrency import run_in_threadpool

from src.core import share_links

router = APIRouter(prefix="/s", tags=["share"])


@router.get("/{code}", include_in_schema=False)
async def open_link(code: str):
    data, name, mime = await run_in_threadpool(share_links.resolve, code)
    # inline: PDFs and images open in the browser; the name is what "Save" offers.
    return Response(data, media_type=mime, headers={
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "private, max-age=300",
        "X-Robots-Tag": "noindex",
    })
