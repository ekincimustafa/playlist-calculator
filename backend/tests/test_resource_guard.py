import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import main, resource_guard
from backend.resource_guard import ResourceGuard
from backend.tests.test_main import DUMMY_KEY, VIDEO_ID, OTHER_VIDEO_ID, playlist_page, video_item, youtube_response


class Clock:
    def __init__(self):
        self.now = 0

    def __call__(self):
        return self.now


def observed_event(waiter_ready):
    class ObservedEvent:
        def __init__(self):
            self.event = Event()

        def wait(self, timeout):
            waiter_ready.set()
            return self.event.wait(timeout)

        def set(self):
            self.event.set()
    return ObservedEvent


class GuardTests(unittest.TestCase):
    def test_cache_expires_after_ttl_and_hits_do_not_extend_freshness(self):
        clock = Clock()
        guard = ResourceGuard(clock=clock)
        loader = Mock(side_effect=[{"value": 1}, {"value": 2}])
        self.assertEqual(guard.get_or_load("key", loader), ({"value": 1}, "MISS"))
        clock.now = 299
        self.assertEqual(guard.get_or_load("key", loader), ({"value": 1}, "HIT"))
        clock.now = 300
        self.assertEqual(guard.get_or_load("key", loader), ({"value": 2}, "MISS"))
        self.assertEqual(loader.call_count, 2)

    def test_cached_values_are_independent_of_caller_and_loader_mutation(self):
        original = {"videos": [{"title": "original"}]}
        guard = ResourceGuard()
        value, _ = guard.get_or_load("key", lambda: original)
        value["videos"][0]["title"] = "caller change"
        original["videos"][0]["title"] = "loader change"
        cached, status = guard.get_or_load("key", lambda: self.fail("Unexpected reload"))
        self.assertEqual(status, "HIT")
        self.assertEqual(cached["videos"][0]["title"], "original")

    def test_lru_entry_limit_preserves_recently_used_results(self):
        guard = ResourceGuard(max_entries=2)
        loader = Mock(return_value={"value": 1})
        for key in ["a", "b", "a", "c"]:
            guard.get_or_load(key, loader)
        self.assertEqual(guard.get_or_load("a", loader)[1], "HIT")
        self.assertEqual(guard.get_or_load("b", loader)[1], "MISS")
        self.assertEqual(loader.call_count, 4)

    def test_cache_byte_limit_evicts_results_even_below_entry_limit(self):
        guard = ResourceGuard(max_cache_bytes=70, max_entry_bytes=70)
        loader = Mock(return_value={"value": "x" * 40})
        guard.get_or_load("a", loader)
        guard.get_or_load("b", loader)
        self.assertEqual(guard.get_or_load("b", loader)[1], "HIT")
        self.assertEqual(guard.get_or_load("a", loader)[1], "MISS")
        self.assertEqual(loader.call_count, 3)

    def test_large_utf8_results_still_return_but_are_not_cached(self):
        guard = ResourceGuard(max_entry_bytes=30)
        value = {"title": "ş" * 15}
        loader = Mock(return_value=value)
        self.assertEqual(guard.get_or_load("key", loader), (value, "MISS"))
        self.assertEqual(guard.get_or_load("key", loader), (value, "MISS"))
        self.assertEqual(loader.call_count, 2)

    def test_video_and_playlist_cache_namespaces_are_separate(self):
        guard = ResourceGuard()
        self.assertEqual(guard.get_or_load(("video", VIDEO_ID), lambda: {"kind": "video"})[0], {"kind": "video"})
        self.assertEqual(guard.get_or_load(("playlist", VIDEO_ID), lambda: {"kind": "playlist"})[0], {"kind": "playlist"})

    def test_upstream_bucket_exhausts_and_refills_without_sleeping(self):
        clock = Clock()
        guard = ResourceGuard(upstream_burst=2, upstream_rate=2, clock=clock)
        guard.consume_upstream_request()
        guard.consume_upstream_request()
        with self.assertRaises(HTTPException) as error:
            guard.consume_upstream_request()
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(error.exception.headers, {"Retry-After": "1"})
        clock.now = 0.5
        guard.consume_upstream_request()
        clock.now = 100
        guard.consume_upstream_request()
        guard.consume_upstream_request()
        with self.assertRaises(HTTPException):
            guard.consume_upstream_request()

    def test_parallel_consumers_cannot_overspend_the_bucket(self):
        guard = ResourceGuard(upstream_burst=3, clock=Clock())

        def consume(_):
            try:
                guard.consume_upstream_request()
                return 200
            except HTTPException as error:
                return error.status_code

        with ThreadPoolExecutor(max_workers=12) as executor:
            statuses = list(executor.map(consume, range(30)))
        self.assertEqual(statuses.count(200), 3)
        self.assertEqual(statuses.count(429), 27)

    def test_same_key_joins_one_load_and_copies_the_result(self):
        guard = ResourceGuard()
        owner_ready, waiter_ready, release = Event(), Event(), Event()
        calls = []

        def load():
            calls.append("load")
            owner_ready.set()
            if not release.wait(3):
                raise AssertionError("Owner was not released")
            return {"videos": [{"title": "shared"}]}

        with patch.object(resource_guard, "Event", observed_event(waiter_ready)), ThreadPoolExecutor(max_workers=2) as executor:
            owner = executor.submit(guard.get_or_load, "key", load)
            try:
                self.assertTrue(owner_ready.wait(2))
                waiter = executor.submit(guard.get_or_load, "key", lambda: self.fail("Duplicate load"))
                self.assertTrue(waiter_ready.wait(2))
                release.set()
                first, first_status = owner.result(timeout=2)
                second, second_status = waiter.result(timeout=2)
            finally:
                release.set()
        self.assertEqual(calls, ["load"])
        self.assertEqual((first_status, second_status), ("MISS", "SHARED"))
        first["videos"][0]["title"] = "mutated"
        self.assertEqual(second["videos"][0]["title"], "shared")

    def test_active_work_limit_preserves_cached_access_and_releases_capacity(self):
        guard = ResourceGuard(max_active=1)
        guard.get_or_load("cached", lambda: {"value": "cached"})
        ready, release = Event(), Event()

        def load():
            ready.set()
            if not release.wait(3):
                raise AssertionError("Owner was not released")
            return {"value": "loaded"}

        with ThreadPoolExecutor(max_workers=1) as executor:
            owner = executor.submit(guard.get_or_load, "active", load)
            try:
                self.assertTrue(ready.wait(2))
                with self.assertRaises(HTTPException) as error:
                    guard.get_or_load("other", lambda: self.fail("Over limit"))
                self.assertEqual(error.exception.status_code, 503)
                self.assertEqual(error.exception.headers, {"Retry-After": "2"})
                self.assertEqual(guard.get_or_load("cached", lambda: self.fail("Cache miss"))[1], "HIT")
            finally:
                release.set()
            owner.result(timeout=2)
        self.assertEqual(guard.get_or_load("other", lambda: {"value": "ok"})[1], "MISS")

    def test_waiter_limit_is_bounded_and_errors_do_not_poison_future_requests(self):
        guard = ResourceGuard(max_waiters=1)
        owner_ready, waiter_ready, release = Event(), Event(), Event()

        def load():
            owner_ready.set()
            if not release.wait(3):
                raise AssertionError("Owner was not released")
            raise HTTPException(429, "Limited", headers={"Retry-After": "3"})

        with patch.object(resource_guard, "Event", observed_event(waiter_ready)), ThreadPoolExecutor(max_workers=2) as executor:
            owner = executor.submit(guard.get_or_load, "key", load)
            try:
                self.assertTrue(owner_ready.wait(2))
                waiter = executor.submit(guard.get_or_load, "key", lambda: self.fail("Duplicate load"))
                self.assertTrue(waiter_ready.wait(2))
                with self.assertRaises(HTTPException) as error:
                    guard.get_or_load("key", lambda: self.fail("Over limit"))
                self.assertEqual(error.exception.status_code, 503)
                release.set()
                first_error = owner.exception(timeout=2)
                second_error = waiter.exception(timeout=2)
            finally:
                release.set()
        self.assertIsNot(first_error, second_error)
        self.assertEqual(second_error.status_code, 429)
        self.assertEqual(second_error.headers, {"Retry-After": "3"})
        self.assertEqual(guard.get_or_load("key", lambda: {"value": "recovered"})[1], "MISS")

    def test_unexpected_failure_wakes_waiters_without_sharing_exception_secrets(self):
        guard = ResourceGuard()
        owner_ready, waiter_ready, release = Event(), Event(), Event()

        def load():
            owner_ready.set()
            if not release.wait(3):
                raise AssertionError("Owner was not released")
            raise ValueError("sensitive request URL")

        with patch.object(resource_guard, "Event", observed_event(waiter_ready)), ThreadPoolExecutor(max_workers=2) as executor:
            owner = executor.submit(guard.get_or_load, "key", load)
            try:
                self.assertTrue(owner_ready.wait(2))
                waiter = executor.submit(guard.get_or_load, "key", lambda: self.fail("Duplicate load"))
                self.assertTrue(waiter_ready.wait(2))
                release.set()
                self.assertIsInstance(owner.exception(timeout=2), ValueError)
                error = waiter.exception(timeout=2)
            finally:
                release.set()
        self.assertEqual(error.status_code, 500)
        self.assertNotIn("sensitive", error.detail)
        self.assertEqual(guard.get_or_load("key", lambda: {"value": "ok"})[1], "MISS")

    def test_waiter_timeout_does_not_cancel_the_owner_or_leak_waiter_slots(self):
        guard = ResourceGuard(max_waiters=1)
        ready, release = Event(), Event()

        class TimeoutEvent:
            def wait(self, timeout):
                return False

            def set(self):
                pass

        def load():
            ready.set()
            if not release.wait(3):
                raise AssertionError("Owner was not released")
            return {"value": "ok"}

        with patch.object(resource_guard, "Event", TimeoutEvent), ThreadPoolExecutor(max_workers=1) as executor:
            owner = executor.submit(guard.get_or_load, "key", load)
            try:
                self.assertTrue(ready.wait(2))
                for _ in range(2):
                    with self.assertRaises(HTTPException) as error:
                        guard.get_or_load("key", lambda: self.fail("Duplicate load"))
                    self.assertEqual(error.exception.status_code, 504)
            finally:
                release.set()
            owner.result(timeout=2)
        self.assertEqual(guard.get_or_load("key", lambda: self.fail("Cache miss"))[1], "HIT")


class CacheApiTests(unittest.TestCase):
    def setUp(self):
        self.key_patch = patch.object(main, "API_KEY", DUMMY_KEY)
        self.key_patch.start()
        self.addCleanup(self.key_patch.stop)
        self.get_patch = patch.object(main.requests, "get")
        self.get = self.get_patch.start()
        self.addCleanup(self.get_patch.stop)
        self.guard_patch = patch.object(main, "resource_guard", ResourceGuard())
        self.guard_patch.start()
        self.addCleanup(self.guard_patch.stop)
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)

    def test_repeated_video_uses_one_google_call_and_keeps_the_json_contract(self):
        self.get.return_value = youtube_response({"items": [video_item()]})
        first = self.client.get(f"/api/video/{VIDEO_ID}")
        second = self.client.get(f"/api/video/{VIDEO_ID}")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(set(first.json()), {"total_videos", "videos"})
        self.assertEqual((first.headers["x-playlist-cache"], second.headers["x-playlist-cache"]), ("MISS", "HIT"))
        self.assertEqual(second.headers["cache-control"], "no-store")
        self.assertEqual(self.get.call_count, 1)

    def test_playlist_is_cached_only_after_all_pages_have_succeeded(self):
        self.get.side_effect = [
            playlist_page(VIDEO_ID, next_page_token="second"),
            youtube_response({"items": [video_item()]}),
            playlist_page(OTHER_VIDEO_ID),
            youtube_response({"items": [video_item(OTHER_VIDEO_ID)]}),
        ]
        first = self.client.get("/api/playlist/PLtest123")
        second = self.client.get("/api/playlist/PLtest123")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(first.json()["total_videos"], 2)
        self.assertEqual(second.headers["x-playlist-cache"], "HIT")
        self.assertEqual(self.get.call_count, 4)

    def test_error_response_is_not_cached_and_a_later_retry_can_succeed(self):
        self.get.side_effect = [youtube_response({"items": []}), youtube_response({"items": [video_item()]})]
        self.assertEqual(self.client.get(f"/api/video/{VIDEO_ID}").status_code, 404)
        recovered = self.client.get(f"/api/video/{VIDEO_ID}")
        self.assertEqual(recovered.status_code, 200)
        self.assertEqual(recovered.headers["x-playlist-cache"], "MISS")
        self.assertEqual(self.client.get(f"/api/video/{VIDEO_ID}").headers["x-playlist-cache"], "HIT")
        self.assertEqual(self.get.call_count, 2)

    def test_cached_access_survives_exhausted_budget_and_forwarded_headers_cannot_reset_it(self):
        with patch.object(main, "resource_guard", ResourceGuard(upstream_burst=1, clock=Clock())):
            self.get.return_value = youtube_response({"items": [video_item()]})
            self.assertEqual(self.client.get(f"/api/video/{VIDEO_ID}").status_code, 200)
            cached = self.client.get(f"/api/video/{VIDEO_ID}?nonce=123", headers={"X-Forwarded-For": "192.0.2.1"})
            self.assertEqual(cached.status_code, 200)
            self.assertEqual(cached.headers["x-playlist-cache"], "HIT")
            limited = self.client.get(f"/api/video/{OTHER_VIDEO_ID}", headers={"X-Forwarded-For": "192.0.2.2"})
            self.assertEqual(limited.status_code, 429)
            self.assertIn("detail", limited.json())
            self.assertEqual(limited.headers["retry-after"], "1")
            self.assertEqual(self.get.call_count, 1)

    def test_expired_result_is_refetched_with_fresh_video_metadata(self):
        clock = Clock()
        with patch.object(main, "resource_guard", ResourceGuard(clock=clock)):
            self.get.side_effect = [youtube_response({"items": [video_item()]}), youtube_response({"items": [video_item(title="Updated title")]})]
            first = self.client.get(f"/api/video/{VIDEO_ID}")
            clock.now = 300
            updated = self.client.get(f"/api/video/{VIDEO_ID}")
            self.assertNotEqual(first.json(), updated.json())
            self.assertEqual(updated.json()["videos"][0]["title"], "Updated title")
            self.assertEqual(updated.headers["x-playlist-cache"], "MISS")
            self.assertEqual(self.get.call_count, 2)

    def test_concurrent_http_requests_share_one_upstream_call(self):
        owner_ready, waiter_ready, release = Event(), Event(), Event()

        def upstream(*_args, **_kwargs):
            owner_ready.set()
            if not release.wait(3):
                raise AssertionError("Upstream was not released")
            return youtube_response({"items": [video_item()]})

        self.get.side_effect = upstream
        with patch.object(resource_guard, "Event", observed_event(waiter_ready)), ThreadPoolExecutor(max_workers=2) as executor:
            owner = executor.submit(self.client.get, f"/api/video/{VIDEO_ID}")
            try:
                self.assertTrue(owner_ready.wait(2))
                waiter = executor.submit(self.client.get, f"/api/video/{VIDEO_ID}")
                self.assertTrue(waiter_ready.wait(2))
                release.set()
                first, second = owner.result(timeout=2), waiter.result(timeout=2)
            finally:
                release.set()
        self.assertEqual((first.status_code, second.status_code), (200, 200))
        self.assertEqual(first.json(), second.json())
        self.assertEqual((first.headers["x-playlist-cache"], second.headers["x-playlist-cache"]), ("MISS", "SHARED"))
        self.assertEqual(self.get.call_count, 1)

    def test_failed_second_page_is_not_cached_and_a_complete_retry_is_cached(self):
        self.get.side_effect = [
            playlist_page(VIDEO_ID, next_page_token="second"),
            youtube_response({"items": [video_item()]}),
            playlist_page(OTHER_VIDEO_ID),
            youtube_response({"error": {"message": "Temporary quota error"}}, 403),
            playlist_page(VIDEO_ID, OTHER_VIDEO_ID),
            youtube_response({"items": [video_item(), video_item(OTHER_VIDEO_ID)]}),
        ]
        self.assertEqual(self.client.get("/api/playlist/PLtest123").status_code, 400)
        recovered = self.client.get("/api/playlist/PLtest123")
        self.assertEqual(recovered.status_code, 200)
        self.assertEqual(recovered.json()["total_videos"], 2)
        self.assertEqual(recovered.headers["x-playlist-cache"], "MISS")
        cached = self.client.get("/api/playlist/PLtest123")
        self.assertEqual(cached.headers["x-playlist-cache"], "HIT")
        self.assertEqual(cached.json(), recovered.json())
        self.assertEqual(self.get.call_count, 6)


if __name__ == "__main__":
    unittest.main()
