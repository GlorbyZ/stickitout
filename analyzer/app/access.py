"""Optional access gate. When ACCESS_TOKEN is set, every request except /healthz
must carry the key in one of these ways:

  * a link with ?key=<token>: the server sets an HttpOnly cookie and redirects to
    the same URL without the key, so the key does not linger in the address bar;
  * the cookie set by that link (sio_access, 30 days);
  * an "X-Access-Token: <token>" or "Authorization: Bearer <token>" header (scripts).

The cookie holds a SHA-256 digest of the token, never the token itself. This is a
shared-secret gate for a private test link, not user accounts.
"""
from __future__ import annotations

import hashlib
import hmac
from urllib.parse import parse_qsl, urlencode

from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse

COOKIE = "sio_access"
OPEN_PATHS = {"/healthz"}

LOCKED_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Access key needed</title>
<link rel="icon" href="data:,"><style>body{font:16px system-ui,sans-serif;background:#faf8f2;display:flex;min-height:90vh;
align-items:center;justify-content:center;margin:0}form{background:#fff;border:1px solid #e7e2d4;border-radius:14px;
padding:24px;max-width:360px}input{font:inherit;padding:9px;width:100%;box-sizing:border-box;margin:10px 0;border:1px solid #ccc;
border-radius:8px}button{font:inherit;background:#f5c518;border:1px solid #c99a00;border-radius:9px;padding:9px 18px;font-weight:700}
</style></head><body><form method="get" action="/"><h2>Stick It Out Analyzer</h2>
<p>This analyzer is private. Open the full link you were sent, or enter the access key.</p>
<input name="key" type="password" placeholder="Access key" autocomplete="off" required><button>Open</button></form></body></html>"""


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class AccessGate:
    """Pure ASGI middleware, so large upload bodies stream through untouched."""

    def __init__(self, app, token: str):
        self.app, self.token, self.cookie_value = app, token, _digest(token)

    def _ok(self, candidate: str | None) -> bool:
        return bool(candidate) and hmac.compare_digest(candidate.encode(), self.token.encode())

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self.token or scope["path"] in OPEN_PATHS:
            return await self.app(scope, receive, send)
        req = Request(scope)
        query = dict(parse_qsl(scope.get("query_string", b"").decode()))
        if "key" in query:
            if not self._ok(query["key"]):
                return await self._deny(req, scope, receive, send, "Wrong access key.")
            rest = urlencode({k: v for k, v in query.items() if k != "key"})
            resp = RedirectResponse(scope["path"] + (f"?{rest}" if rest else ""), status_code=303)
            secure = req.headers.get("x-forwarded-proto", req.url.scheme) == "https"
            resp.set_cookie(COOKIE, self.cookie_value, max_age=30 * 86400, httponly=True, samesite="lax", secure=secure)
            return await resp(scope, receive, send)
        bearer = req.headers.get("authorization", "")
        header_token = req.headers.get("x-access-token") or (bearer[7:] if bearer.lower().startswith("bearer ") else None)
        cookie = req.cookies.get(COOKIE, "")
        if self._ok(header_token) or (cookie and hmac.compare_digest(cookie.encode(), self.cookie_value.encode())):
            return await self.app(scope, receive, send)
        return await self._deny(req, scope, receive, send, "Access key required.")

    async def _deny(self, req, scope, receive, send, message):
        if req.url.path.startswith("/api/"):
            resp = JSONResponse({"error": f"{message} Open the analyzer link that includes ?key=, or send an X-Access-Token header."},
                                status_code=401)
        else:
            resp = HTMLResponse(LOCKED_PAGE, status_code=401)
        await resp(scope, receive, send)
