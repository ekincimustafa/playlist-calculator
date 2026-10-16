"""Exercise production CORS policy without contacting Google."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import main
from backend.tests.test_main import DUMMY_KEY, VIDEO_ID, video_item, youtube_response


SITE_ORIGINS = [
    "https://ytplaylistcalculator.com",
    "https://www.ytplaylistcalculator.com",
]
EXTENSION_ORIGIN = "chrome-extension://ecdjlbdgjnlmjhmdllgnfakocdcpaieg"
UNTRUSTED_ORIGINS = [
    "https://other.example",
    "https://ytplaylistcalculator.com.other.example",
    "https://other.ytplaylistcalculator.com",
    "https://ytplaylistcalculator.com@other.example",
    "http://ytplaylistcalculator.com",
    "https://ytplaylistcalculator.com:8443",
    "null",
    "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    EXTENSION_ORIGIN + ".other.example",
]


class CorsTests(unittest.TestCase):
    def setUp(self):
        for attribute, value in [
            ("API_KEY", DUMMY_KEY),
            ("resource_guard", main.ResourceGuard()),
        ]:
            patcher = patch.object(main, attribute, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(main.requests, "get", return_value=youtube_response({"items": [video_item()]}))
        self.get = patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)

    def preflight(self, origin, method="GET", headers=None):
        request_headers = {"Origin": origin, "Access-Control-Request-Method": method}
        if headers:
            request_headers["Access-Control-Request-Headers"] = headers
        return self.client.options(f"/api/video/{VIDEO_ID}", headers=request_headers)

    def test_site_and_published_extension_can_read_identical_results_and_cache_hits(self):
        expected = None
        for origin in SITE_ORIGINS + [EXTENSION_ORIGIN]:
            with self.subTest(origin=origin):
                response = self.client.get(f"/api/video/{VIDEO_ID}", headers={"Origin": origin})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
                self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
                self.assertIn("origin", response.headers["Vary"].lower())
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                if expected is None:
                    expected = response.json()
                    self.assertEqual(response.headers["X-Playlist-Cache"], "MISS")
                else:
                    self.assertEqual(response.json(), expected)
                    self.assertEqual(response.headers["X-Playlist-Cache"], "HIT")
        self.get.assert_called_once()

    def test_only_allowed_origins_receive_successful_get_preflights(self):
        for origin in SITE_ORIGINS + [EXTENSION_ORIGIN]:
            with self.subTest(origin=origin):
                response = self.preflight(origin)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
                self.assertEqual(response.headers["Access-Control-Allow-Methods"], "GET")
                self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
        self.get.assert_not_called()

    def test_unknown_and_lookalike_origins_have_no_read_permission(self):
        for origin in UNTRUSTED_ORIGINS:
            with self.subTest(origin=origin):
                # CORS does not reject a simple request at the server.
                response = self.client.get("/", headers={"Origin": origin})
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("Access-Control-Allow-Origin", response.headers)
                self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
                response = self.preflight(origin)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.get.assert_not_called()

    def test_preflights_reject_unneeded_methods_and_headers_without_youtube_work(self):
        for origin in SITE_ORIGINS + [EXTENSION_ORIGIN]:
            for method in ["POST", "PUT", "PATCH", "DELETE"]:
                with self.subTest(origin=origin, method=method):
                    self.assertEqual(self.preflight(origin, method).status_code, 400)
            for header in ["Authorization", "X-Arbitrary-Header"]:
                with self.subTest(origin=origin, header=header):
                    self.assertEqual(self.preflight(origin, headers=header).status_code, 400)
        self.get.assert_not_called()

    def test_allowed_origins_can_read_validation_and_upstream_errors(self):
        self.get.return_value = youtube_response({"items": []}, status=503)
        for origin in SITE_ORIGINS + [EXTENSION_ORIGIN]:
            for path, status in [("/api/video/short", 400), (f"/api/video/{VIDEO_ID}", 502)]:
                with self.subTest(origin=origin, status=status):
                    response = self.client.get(path, headers={"Origin": origin})
                    self.assertEqual(response.status_code, status)
                    self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
                    self.assertNotIn("Access-Control-Allow-Credentials", response.headers)

    def test_originless_clients_remain_compatible(self):
        response = self.client.get(f"/api/video/{VIDEO_ID}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total_videos"], 1)
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertNotIn("Access-Control-Allow-Credentials", response.headers)


if __name__ == "__main__":
    unittest.main()
