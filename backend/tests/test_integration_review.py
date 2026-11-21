"""Cross-PR regression: positions, loop failure, retry and cache."""
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import main
from test_main import youtube_response, video_item, VIDEO_ID, OTHER_VIDEO_ID, PLAYLIST_ID

class CombinedTests(unittest.TestCase):
    def test_positioned_duplicates_survive_loop_failure_retry_and_cache(self):
        page = {"items": [
            {"contentDetails": {"videoId": v}, "snippet": {"position": p}}
            for v, p in [(VIDEO_ID, 0), ('missing1234', 1), (OTHER_VIDEO_ID, 2), (VIDEO_ID, 3)]
        ]}
        details = youtube_response({"items": [video_item(OTHER_VIDEO_ID, duration='PT5M'), video_item()]})
        loop_page = youtube_response({**page, 'nextPageToken': 'same'})
        guard = main.ResourceGuard(max_active=1)
        with patch.object(main, 'API_KEY', 'dummy'), patch.object(main, 'resource_guard', guard), patch.object(main.requests, 'get') as get, TestClient(main.app) as client:
            get.side_effect = [loop_page, details, loop_page, details]
            response = client.get(f'/api/playlist/{PLAYLIST_ID}')
            self.assertEqual(response.status_code, 502)
            self.assertEqual(get.call_count, 4)
            self.assertEqual(response.json(), {'detail': main.INVALID_UPSTREAM_RESPONSE})
            get.side_effect = [youtube_response(page), details]
            result = client.get(f'/api/playlist/{PLAYLIST_ID}')
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.headers['x-playlist-cache'], 'MISS')
            self.assertEqual([v['position'] for v in result.json()['videos']], [1, 3, 4])
            self.assertEqual([v['id'] for v in result.json()['videos']], [VIDEO_ID, OTHER_VIDEO_ID, VIDEO_ID])
            self.assertEqual(result.json()['total_videos'], 3)
            cached = client.get(f'/api/playlist/{PLAYLIST_ID}')
            self.assertEqual(cached.json(), result.json())
            self.assertEqual(cached.headers['x-playlist-cache'], 'HIT')
            self.assertEqual(get.call_count, 6)
