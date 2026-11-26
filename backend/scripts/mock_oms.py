"""A stand-in OMS for testing on one machine. Accepts orders and keeps them in memory.

    python scripts/mock_oms.py            # listens on http://127.0.0.1:8100
    CRM .env:  OMS_API_URL=http://127.0.0.1:8100   OMS_API_KEY=local-oms-key

It never calls the CRM back. To report a status, sign a request as in ../GIFTING_INTEGRATION.md.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = "local-oms-key"
ORDERS: dict[str, str] = {}  # idempotency key -> reference


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802 - http.server's name
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path != "/gift-orders":
            return self._reply(404, {"message": "Not found"})
        if self.headers.get("X-API-Key") != KEY:
            return self._reply(401, {"message": "Bad key"})
        key = self.headers.get("Idempotency-Key")
        if not key:
            return self._reply(422, {"message": "Idempotency-Key is required"})
        repeat = key in ORDERS
        reference = ORDERS.setdefault(key, f"MOCK-{len(ORDERS) + 1:04d}")
        print("repeat" if repeat else "new order", reference, json.loads(raw).get("requestCode"))
        return self._reply(200 if repeat else 201, {"reference": reference})


if __name__ == "__main__":
    print("Mock OMS on http://127.0.0.1:8100")
    ThreadingHTTPServer(("127.0.0.1", 8100), Handler).serve_forever()
