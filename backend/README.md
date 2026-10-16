# Playlist API

Run from this directory with `uvicorn main:app --host 0.0.0.0 --port 8000`,
or from the repository root with `uvicorn backend.main:app`.
Set `YOUTUBE_API_KEY` in the server environment. Install runtime dependencies
with `python -m pip install -r requirements.txt`.

## Browser access (CORS)

The production browser allowlist in `main.CORS_ALLOWED_ORIGINS` contains only:

- `https://ytplaylistcalculator.com`
- `https://www.ytplaylistcalculator.com`
- `chrome-extension://ecdjlbdgjnlmjhmdllgnfakocdcpaieg` (the published extension)

Only `GET` is allowed by CORS. Cross-origin credentials are disabled, and
additional request headers such as `Authorization` are not allowed. The
existing website and popup use ordinary, credential-free `fetch` requests;
no extension permission or Web Store update is required for this change.

For local development, add the exact local frontend origin or unpacked
extension origin to a **local** allowlist. Unpacked extension IDs can differ
from the published ID. Do not deploy wildcard origins, `null`, or a pattern
that trusts every Chrome extension. Origins contain no trailing slash or path.

CORS controls whether a browser exposes a response to another origin; it is
not authentication or a quota firewall. Simple cross-origin requests can still
reach the server, and non-browser clients can omit or spoof `Origin`. The
resource limits below and Google Cloud quotas remain necessary.

## Cache and resource limits

Successful video/playlist results are temporarily stored in **worker memory**.
The response JSON and calculation behavior are unchanged. Metadata can be up
to five minutes old; errors and incomplete calculations are never cached.
No account information or client IP addresses are stored by this layer.

Defaults in `resource_guard.ResourceGuard`:

| Control | Default |
| --- | --- |
| Cache TTL | 300 seconds after a successful load |
| Cache entries | 128, evicting least recently used entries |
| Cache payload bytes | 10 MiB total; entries larger than 1 MiB bypass storage |
| Simultaneous distinct calculations | 4 |
| Total requests waiting for an existing calculation | 12 |
| Wait for an existing calculation | At most 120 seconds |
| Upstream token bucket | 300 initial/capacity tokens; refill 2 tokens/second |

Every attempted Google API request consumes one token, including failures
and additional playlist pages. Token exhaustion returns HTTP 429 and
`Retry-After`; capacity exhaustion returns 503. Cached results continue to
work without consuming tokens or a calculation slot. Simultaneous requests
for the same result share one calculation. A timed-out waiter does not cancel
the original calculation; it can retry and use the completed cache entry.

These are **per-process controls**, not project-wide daily quotas or per-IP
limits. They reset on restart and each worker/instance has its own allowance.
The application does not trust caller-supplied forwarding headers to grant
extra allowance. Configure shared limits at an edge/shared store before
relying on these settings across multiple workers or instances. Keep the
Google Cloud key restrictions and quota limits in place.

`X-Playlist-Cache` reports `MISS`, `HIT`, or `SHARED` for diagnostics.
`Cache-Control: no-store` prevents an additional browser/proxy response cache;
the five-minute cache is managed inside the application. There is no persistent
cache database, and memory contents disappear on restart. The waiter timeout
does not impose a total deadline on the original calculation. Individual
Google calls retain their connection/read timeouts.

## Tests

From the repository root:

```sh
python -m pip install -r backend/requirements-dev.txt
python -m unittest discover -s backend/tests -v
node --test tests/frontend-security.test.cjs
```

Tests use a dummy API key and mock Google calls; they do not spend live quota.
