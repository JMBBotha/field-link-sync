"""Read-only guard for Playwright checks against the live backend.

Call `await install_readonly_guard(context)` right after creating the browser
context. Every non-GET request to the backend (REST inserts/updates/deletes,
RPC, storage uploads, edge functions) is answered locally with a fake success
and never reaches the database. Auth token refresh is allowed through.
Blocked calls are collected in the returned list so scripts can print them.
"""
import json

BACKEND_HINTS = ("/rest/v1/", "/storage/v1/", "/functions/v1/")


async def install_readonly_guard(context):
    blocked = []

    async def handle(route):
        req = route.request
        url = req.url
        if req.method in ("GET", "HEAD", "OPTIONS") or not any(h in url for h in BACKEND_HINTS):
            return await route.continue_()
        # PostgREST reads sent as POST (rpc) are still blocked: RPCs may write.
        blocked.append(f"{req.method} {url.split('?')[0]}")
        await route.fulfill(status=200, content_type="application/json", body=json.dumps([]))

    await context.route("**/*", handle)
    return blocked
