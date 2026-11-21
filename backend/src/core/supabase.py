"""Supabase clients. Service-role bypasses RLS: services must enforce access themselves."""
import logging
from functools import lru_cache

import httpx
from supabase import Client, ClientOptions, create_client

from src.core.config import settings

log = logging.getLogger(__name__)
EDGE_RETRIES = 2


class _EdgeRetryTransport(httpx.HTTPTransport):
    """Retry when the proxy in front of Supabase answers with an HTML error page.

    PostgREST only ever answers in JSON. An HTML 400 (or 502/503/504) is Cloudflare, not our query, and
    it is transient: a stale or recycled connection. Plain reads are retried on any of them; writes only
    on 400, which the edge returns before the request ever reaches the database, so a retry cannot double-write.
    """

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        safe_codes = {400, 502, 503, 504} if request.method in ("GET", "HEAD") else {400}
        for attempt in range(EDGE_RETRIES + 1):
            response = super().handle_request(request)
            from_edge = "text/html" in response.headers.get("content-type", "")
            if response.status_code in safe_codes and from_edge and attempt < EDGE_RETRIES:
                log.warning("edge returned %s for %s %s, retrying", response.status_code, request.method, request.url.path)
                response.close()
                continue
            return response
        return response  # pragma: no cover


def _keep_warm(client: Client) -> Client:
    """One pooled client that keeps connections to Supabase open between requests.

    httpx drops idle connections after 5 seconds by default, so almost every API call paid a fresh TLS
    handshake (over a second on a distant region). HTTP/1.1 with a pool is used on purpose: it was as fast
    as HTTP/2 here and does not depend on one long-lived multiplexed connection surviving the proxy.
    """
    pg = client.postgrest
    old = pg.session
    pg.session = httpx.Client(
        base_url=old.base_url,
        headers=old.headers,
        timeout=old.timeout,
        follow_redirects=True,
        transport=_EdgeRetryTransport(
            http2=False,
            retries=2,  # connection-level failures
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16, keepalive_expiry=45),
        ),
    )
    old.close()
    return client


@lru_cache
def get_anon_client() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)


@lru_cache
def get_service_client() -> Client:
    return _keep_warm(create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY))


def get_user_client(access_token: str) -> Client:
    """Client that runs with the user's token, so RLS applies."""
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_ANON_KEY,
        options=ClientOptions(headers={"Authorization": f"Bearer {access_token}"}),
    )


def new_anon_client() -> Client:
    """A throwaway anon client. Auth calls store the signed-in session on the client, so they
    must never share one."""
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
