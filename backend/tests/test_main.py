"""Run from the repository root:

python -m pip install -r backend/requirements-dev.txt
python -m unittest discover -s backend/tests -v

FastAPI is exercised in process; all YouTube calls are mocked and use a dummy key.
"""
import json
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, quote, urlsplit

import requests
from fastapi.testclient import TestClient

from backend import main


DUMMY_KEY = "local-test-key-not-a-real-google-key"
VIDEO_ID = "abcdefghijk"
OTHER_VIDEO_ID = "lmnopqrstuv"
PLAYLIST_ID = "PLtest_123-abc"


def youtube_response(data, status=200):
    response = requests.Response()
    response.status_code = status
    response._content = json.dumps(data).encode("utf-8")
    response.headers["Content-Type"] = "application/json"
    return response


def video_item(video_id=VIDEO_ID, title="Test video", duration="PT10M"):
    return {
        "id": video_id,
        "snippet": {
            "title": title,
            "thumbnails": {"medium": {"url": "https://i.ytimg.com/test.jpg"}},
        },
        "contentDetails": {"duration": duration},
    }


def playlist_page(*video_ids, next_page_token=None):
    data = {"items": [{"contentDetails": {"videoId": video_id}} for video_id in video_ids]}
    if next_page_token is not None:
        data["nextPageToken"] = next_page_token
    return youtube_response(data)


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.key_patch = patch.object(main, "API_KEY", DUMMY_KEY)
        self.key_patch.start()
        self.addCleanup(self.key_patch.stop)
        self.request_patch = patch.object(main.requests, "get")
        self.get = self.request_patch.start()
        self.addCleanup(self.request_patch.stop)
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)

    def test_root_response_is_unchanged_and_needs_no_youtube_call(self):
        self.assertEqual(self.client.get("/").json(), {"message": "Playlist Calculator Backend is running 🚀"})
        self.get.assert_not_called()

    def test_single_video_success_preserves_the_complete_response_contract(self):
        self.get.return_value = youtube_response({"items": [video_item()]})
        response = self.client.get(f"/api/video/{VIDEO_ID}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "total_videos": 1,
            "videos": [{
                "id": VIDEO_ID, "title": "Test video", "duration": "PT10M",
                "thumbnail": "https://i.ytimg.com/test.jpg",
            }],
        })
        url = self.get.call_args.args[0]
        options = self.get.call_args.kwargs
        self.assertEqual(url, "https://www.googleapis.com/youtube/v3/videos")
        self.assertEqual(options["params"], {"part": "snippet,contentDetails", "id": VIDEO_ID, "key": DUMMY_KEY})
        self.assertEqual(options["headers"], {"referer": "https://ytplaylistcalculator.com/"})
        self.assertEqual(options["timeout"], (5, 15))
        self.assertFalse(options["allow_redirects"])

    def test_invalid_video_ids_are_rejected_before_any_youtube_request(self):
        for invalid in ["short", VIDEO_ID + "x", VIDEO_ID + "\n", "abcdefghijö", VIDEO_ID + "&fields=id", VIDEO_ID + "?key=other", VIDEO_ID + "#fragment", "<script>", "a" * 300]:
            with self.subTest(video_id=invalid):
                response = self.client.get("/api/video/" + quote(invalid, safe=""))
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"detail": "Invalid video ID."})
        self.get.assert_not_called()

    def test_invalid_playlist_ids_are_rejected_before_any_youtube_request(self):
        for invalid in [PLAYLIST_ID + "&maxResults=0", PLAYLIST_ID + "?key=other", PLAYLIST_ID + "#fragment", PLAYLIST_ID + "\n", "PL test", "PLö", "a" * 257]:
            with self.subTest(playlist_id=invalid):
                response = self.client.get("/api/playlist/" + quote(invalid, safe=""))
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"detail": "Invalid playlist ID."})
        self.get.assert_not_called()

    def test_supported_playlist_families_are_not_restricted_to_one_prefix_or_length(self):
        for playlist_id in [PLAYLIST_ID, "UUtest_123", "OLAK5uy_test", "LL", "WL", "a" * 256]:
            with self.subTest(playlist_id=playlist_id):
                self.get.return_value = playlist_page()
                response = self.client.get("/api/playlist/" + playlist_id)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"total_videos": 0, "videos": []})
                self.assertEqual(self.get.call_args.kwargs["params"]["playlistId"], playlist_id)

    def test_mix_rejection_is_unchanged_and_uses_no_youtube_quota(self):
        response = self.client.get("/api/playlist/RDabcdefghijk")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "YouTube Mix playlists are auto-generated and not supported by the API.")
        self.get.assert_not_called()

    def test_missing_key_error_remains_compatible(self):
        with patch.object(main, "API_KEY", None):
            for endpoint, identifier in [("video", VIDEO_ID), ("playlist", PLAYLIST_ID)]:
                with self.subTest(endpoint=endpoint):
                    response = self.client.get(f"/api/{endpoint}/{identifier}")
                    self.assertEqual(response.status_code, 500)
                    self.assertEqual(response.json(), {"detail": "API Key is missing!"})
        self.get.assert_not_called()

    def test_pagination_keeps_order_and_encodes_page_tokens_as_single_values(self):
        token = "page+/=&fields=id#tail"
        self.get.side_effect = [
            playlist_page(VIDEO_ID, next_page_token=token),
            youtube_response({"items": [video_item()]}),
            playlist_page(OTHER_VIDEO_ID),
            youtube_response({"items": [video_item(OTHER_VIDEO_ID, "Second video", "PT5M")]}),
        ]
        response = self.client.get(f"/api/playlist/{PLAYLIST_ID}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total_videos"], 2)
        self.assertEqual([video["id"] for video in response.json()["videos"]], [VIDEO_ID, OTHER_VIDEO_ID])
        self.assertEqual([video["duration"] for video in response.json()["videos"]], ["PT10M", "PT5M"])
        self.assertEqual(self.get.call_count, 4)
        self.assertNotIn("pageToken", self.get.call_args_list[0].kwargs["params"])
        next_call = self.get.call_args_list[2]
        prepared = requests.Request("GET", next_call.args[0], params=next_call.kwargs["params"]).prepare()
        query = parse_qs(urlsplit(prepared.url).query)
        self.assertEqual(query["pageToken"], [token])
        self.assertEqual(query["playlistId"], [PLAYLIST_ID])
        self.assertNotIn("fields", query)
        for call in self.get.call_args_list:
            self.assertEqual(call.kwargs["timeout"], (5, 15))
            self.assertFalse(call.kwargs["allow_redirects"])

    def test_unavailable_playlist_items_and_duplicate_videos_keep_existing_behavior(self):
        self.get.side_effect = [
            playlist_page(VIDEO_ID, OTHER_VIDEO_ID, next_page_token="second"),
            youtube_response({"items": [video_item()]}),
            playlist_page(VIDEO_ID),
            youtube_response({"items": [video_item()]}),
        ]
        response = self.client.get(f"/api/playlist/{PLAYLIST_ID}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([video["id"] for video in response.json()["videos"]], [VIDEO_ID, VIDEO_ID])
        self.assertEqual(response.json()["total_videos"], 2)

    def test_missing_medium_thumbnail_and_video_not_found_keep_existing_fallbacks(self):
        item = video_item()
        item["snippet"]["thumbnails"] = {}
        self.get.return_value = youtube_response({"items": [item]})
        self.assertEqual(self.client.get(f"/api/video/{VIDEO_ID}").json()["videos"][0]["thumbnail"], "")
        self.get.return_value = youtube_response({"items": []})
        response = self.client.get(f"/api/video/{VIDEO_ID}")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Video not found."})

    def test_timeouts_on_each_upstream_stage_return_a_controlled_504(self):
        stages = [
            (f"/api/video/{VIDEO_ID}", [requests.exceptions.ConnectTimeout(DUMMY_KEY)]),
            (f"/api/playlist/{PLAYLIST_ID}", [requests.exceptions.ReadTimeout(DUMMY_KEY)]),
            (f"/api/playlist/{PLAYLIST_ID}", [playlist_page(VIDEO_ID), requests.exceptions.ReadTimeout(DUMMY_KEY)]),
        ]
        for url, responses in stages:
            with self.subTest(url=url, stage=len(responses)):
                self.get.side_effect = responses
                response = self.client.get(url)
                self.assertEqual(response.status_code, 504)
                self.assertIn("timed out", response.json()["detail"])
                self.assertNotIn(DUMMY_KEY, response.text)

    def test_network_exceptions_never_expose_request_urls_or_keys(self):
        self.get.side_effect = requests.exceptions.ConnectionError("https://googleapis.invalid/?key=" + DUMMY_KEY)
        response = self.client.get(f"/api/video/{VIDEO_ID}")
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(DUMMY_KEY, response.text)
        self.assertNotIn("googleapis.invalid", response.text)

    def test_video_details_failure_never_returns_a_successful_partial_playlist(self):
        self.get.side_effect = [
            playlist_page(VIDEO_ID, next_page_token="second"),
            youtube_response({"items": [video_item()]}),
            playlist_page(OTHER_VIDEO_ID),
            youtube_response({"error": {"message": "The request cannot be completed because you have exceeded your quota."}}, 403),
        ]
        response = self.client.get(f"/api/playlist/{PLAYLIST_ID}")
        self.assertEqual(response.status_code, 400)
        self.assertIn("quota", response.json()["detail"])
        self.assertNotIn("videos", response.json())

    def test_youtube_error_messages_are_preserved_with_key_redaction(self):
        self.get.return_value = youtube_response({"error": {"message": "API key " + DUMMY_KEY + " is invalid."}}, 400)
        response = self.client.get(f"/api/video/{VIDEO_ID}")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "API key [redacted] is invalid."})
        self.get.return_value = youtube_response({"error": None}, 403)
        response = self.client.get(f"/api/video/{VIDEO_ID}")
        self.assertEqual(response.status_code, 400)
        self.assertIsInstance(response.json()["detail"], str)

    def test_bad_statuses_and_malformed_json_return_a_controlled_502(self):
        for status in [302, 500, 503]:
            with self.subTest(status=status):
                self.get.return_value = youtube_response({"items": []}, status)
                response = self.client.get(f"/api/video/{VIDEO_ID}")
                self.assertEqual(response.status_code, 502)
        self.get.return_value = youtube_response({"unexpected": "body"}, 403)
        self.assertEqual(self.client.get(f"/api/video/{VIDEO_ID}").status_code, 502)
        invalid_json = requests.Response()
        invalid_json.status_code = 200
        invalid_json._content = b"<html>Bad gateway</html>"
        self.get.return_value = invalid_json
        self.assertEqual(self.client.get(f"/api/video/{VIDEO_ID}").status_code, 502)

    def test_invalid_upstream_shapes_return_a_controlled_502(self):
        for data in [None, [], {}, {"items": None}, {"items": [None]}, {"items": [{}]}, {"items": [video_item()], "nextPageToken": 123}]:
            with self.subTest(data=data):
                self.get.return_value = youtube_response(data)
                response = self.client.get(f"/api/video/{VIDEO_ID}")
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json(), {"detail": main.INVALID_UPSTREAM_RESPONSE})
        for item in [{}, {"contentDetails": None}, {"contentDetails": {"videoId": None}}]:
            with self.subTest(playlist_item=item):
                self.get.return_value = youtube_response({"items": [item]})
                response = self.client.get(f"/api/playlist/{PLAYLIST_ID}")
                self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
