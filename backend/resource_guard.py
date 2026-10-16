"""Bounded, thread-safe cache and upstream admission controls for one worker."""
import json
import math
from collections import OrderedDict
from copy import deepcopy
from threading import Event, Lock
from time import monotonic

from fastapi import HTTPException


class _Flight:
    def __init__(self):
        self.done = Event()
        self.payload = None
        self.error = None


class ResourceGuard:
    def __init__(
        self,
        cache_ttl=300,
        max_entries=128,
        max_cache_bytes=10 * 1024 * 1024,
        max_entry_bytes=1024 * 1024,
        max_active=4,
        max_waiters=12,
        wait_timeout=120,
        upstream_burst=300,
        upstream_rate=2,
        clock=monotonic,
    ):
        if cache_ttl < 0 or any(value <= 0 for value in (
            max_entries, max_cache_bytes, max_entry_bytes, max_active,
            max_waiters, wait_timeout, upstream_burst, upstream_rate,
        )):
            raise ValueError("Resource guard limits must be positive; cache TTL may be zero.")
        self.cache_ttl = cache_ttl
        self.max_entries = max_entries
        self.max_cache_bytes = max_cache_bytes
        self.max_entry_bytes = max_entry_bytes
        self.max_active = max_active
        self.max_waiters = max_waiters
        self.wait_timeout = wait_timeout
        self.upstream_burst = upstream_burst
        self.upstream_rate = upstream_rate
        self.clock = clock
        self._lock = Lock()
        self._cache = OrderedDict()
        self._cache_bytes = 0
        self._flights = {}
        self._waiters = 0
        self._tokens = float(upstream_burst)
        self._last_refill = clock()

    def consume_upstream_request(self):
        """Charge every attempted Google call, including failures and later pages."""
        with self._lock:
            now = self.clock()
            elapsed = max(0, now - self._last_refill)
            self._tokens = min(self.upstream_burst, self._tokens + elapsed * self.upstream_rate)
            self._last_refill = now
            if self._tokens < 1:
                retry_after = max(1, math.ceil((1 - self._tokens) / self.upstream_rate))
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests. Please wait a moment and try again.",
                    headers={"Retry-After": str(retry_after)},
                )
            self._tokens -= 1

    def get_or_load(self, key, loader):
        cached_payload = None
        with self._lock:
            now = self.clock()
            self._remove_expired(now)
            entry = self._cache.get(key)
            if entry is not None:
                self._cache.move_to_end(key)
                cached_payload = entry[1]
            else:
                flight = self._flights.get(key)
                owner = flight is None
                if owner:
                    if len(self._flights) >= self.max_active:
                        raise self._busy()
                    flight = _Flight()
                    self._flights[key] = flight
                else:
                    if self._waiters >= self.max_waiters:
                        raise self._busy()
                    self._waiters += 1

        # Parsing a cached payload must not hold the state lock or share mutable data.
        if cached_payload is not None:
            return json.loads(cached_payload), "HIT"

        if not owner:
            try:
                if not flight.done.wait(self.wait_timeout):
                    raise HTTPException(
                        status_code=504,
                        detail="The calculation is still running. Please try again shortly.",
                        headers={"Retry-After": "2"},
                    )
                if flight.error is not None:
                    status_code, detail, headers = flight.error
                    raise HTTPException(status_code=status_code, detail=deepcopy(detail), headers=dict(headers))
                return json.loads(flight.payload), "SHARED"
            finally:
                with self._lock:
                    self._waiters -= 1

        try:
            value = loader()
            payload = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
            with self._lock:
                self._store(key, payload, self.clock())
                flight.payload = payload
            return json.loads(payload), "MISS"
        except HTTPException as error:
            with self._lock:
                flight.error = (error.status_code, deepcopy(error.detail), dict(error.headers or {}))
            raise
        except BaseException:
            # Wake joined requests even when the loader fails unexpectedly; do not
            # share traceback objects or exception messages that may contain secrets.
            with self._lock:
                flight.error = (500, "The calculation failed. Please try again.", {})
            raise
        finally:
            with self._lock:
                self._flights.pop(key, None)
                flight.done.set()

    def _remove_expired(self, now):
        for key in list(self._cache):
            if self._cache[key][0] <= now:
                self._cache_bytes -= len(self._cache.pop(key)[1])

    def _store(self, key, payload, now):
        if self.cache_ttl == 0 or len(payload) > min(self.max_entry_bytes, self.max_cache_bytes):
            return
        self._remove_expired(now)
        previous = self._cache.pop(key, None)
        if previous is not None:
            self._cache_bytes -= len(previous[1])
        while self._cache and (
            len(self._cache) >= self.max_entries or self._cache_bytes + len(payload) > self.max_cache_bytes
        ):
            self._cache_bytes -= len(self._cache.popitem(last=False)[1][1])
        self._cache[key] = (now + self.cache_ttl, payload)
        self._cache_bytes += len(payload)

    @staticmethod
    def _busy():
        return HTTPException(
            status_code=503,
            detail="The service is busy. Please try again shortly.",
            headers={"Retry-After": "2"},
        )
