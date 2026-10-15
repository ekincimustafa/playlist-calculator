import os
import re
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
API_KEY = os.getenv("YOUTUBE_API_KEY")
YOUTUBE_REQUEST_TIMEOUT = (5, 15)  # Connect timeout, then read inactivity timeout.
INVALID_UPSTREAM_RESPONSE = "YouTube returned an invalid response. Please try again."

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def request_youtube(resource, params):
    try:
        response = requests.get(
            f"https://www.googleapis.com/youtube/v3/{resource}",
            params={**params, "key": API_KEY},
            headers={"referer": "https://ytplaylistcalculator.com/"},
            timeout=YOUTUBE_REQUEST_TIMEOUT,
            allow_redirects=False,
        )
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="YouTube request timed out. Please try again.") from None
    except requests.exceptions.RequestException:
        # Request exceptions can contain the URL, including the API key.
        raise HTTPException(status_code=502, detail="Could not connect to YouTube. Please try again.") from None

    try:
        data = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail=INVALID_UPSTREAM_RESPONSE) from None

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail=INVALID_UPSTREAM_RESPONSE)

    if response.status_code < 200 or 300 <= response.status_code < 400 or response.status_code >= 500:
        raise HTTPException(status_code=502, detail="YouTube is unavailable. Please try again.")

    if "error" in data:
        error = data["error"]
        message = error.get("message") if isinstance(error, dict) else None
        if not isinstance(message, str) or not message:
            message = "YouTube could not process this request."
        if API_KEY:
            message = message.replace(API_KEY, "[redacted]")
        raise HTTPException(status_code=400, detail=message)

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="YouTube could not process this request.")

    items = data.get("items")
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise HTTPException(status_code=502, detail=INVALID_UPSTREAM_RESPONSE)

    next_page_token = data.get("nextPageToken")
    if next_page_token is not None and not isinstance(next_page_token, str):
        raise HTTPException(status_code=502, detail=INVALID_UPSTREAM_RESPONSE)

    return data


def video_details(item):
    try:
        video = {
            "id": item["id"],
            "title": item["snippet"]["title"],
            "duration": item["contentDetails"]["duration"],
            "thumbnail": item["snippet"]["thumbnails"].get("medium", {}).get("url", ""),
        }
    except (KeyError, TypeError, AttributeError):
        raise HTTPException(status_code=502, detail=INVALID_UPSTREAM_RESPONSE) from None
    if any(not isinstance(value, str) for value in video.values()):
        raise HTTPException(status_code=502, detail=INVALID_UPSTREAM_RESPONSE)
    return video


@app.get("/")
def read_root():
    return {"message": "Playlist Calculator Backend is running 🚀"}

@app.get("/api/playlist/{playlist_id}")
def get_playlist_data(playlist_id: str):
    if len(playlist_id) > 256 or not re.fullmatch(r"[A-Za-z0-9_-]+", playlist_id):
        raise HTTPException(status_code=400, detail="Invalid playlist ID.")

    if not API_KEY:
        raise HTTPException(status_code=500, detail="API Key is missing!")

    if playlist_id.startswith("RD"):
        raise HTTPException(status_code=400, detail="YouTube Mix playlists are auto-generated and not supported by the API.")

    videos = []
    next_page_token = None
    while True:
        params = {
            "part": "snippet,contentDetails",
            "maxResults": 50,
            "playlistId": playlist_id,
        }
        if next_page_token:
            params["pageToken"] = next_page_token

        pl_response = request_youtube("playlistItems", params)

        try:
            video_ids = [item["contentDetails"]["videoId"] for item in pl_response["items"]]
        except (KeyError, TypeError):
            raise HTTPException(status_code=502, detail=INVALID_UPSTREAM_RESPONSE) from None
        if any(not isinstance(video_id, str) for video_id in video_ids):
            raise HTTPException(status_code=502, detail=INVALID_UPSTREAM_RESPONSE)
        
        if not video_ids:
            break

        vid_response = request_youtube("videos", {
            "part": "snippet,contentDetails",
            "id": ','.join(video_ids),
        })

        for item in vid_response.get("items", []):
            videos.append(video_details(item))

        next_page_token = pl_response.get("nextPageToken")
        if not next_page_token:
            break

    return {"total_videos": len(videos), "videos": videos}

@app.get("/api/video/{video_id}")
def get_single_video_data(video_id: str):
    if len(video_id) != 11 or not re.fullmatch(r"[A-Za-z0-9_-]+", video_id):
        raise HTTPException(status_code=400, detail="Invalid video ID.")

    if not API_KEY:
        raise HTTPException(status_code=500, detail="API Key is missing!")

    vid_response = request_youtube("videos", {
        "part": "snippet,contentDetails",
        "id": video_id,
    })

    items = vid_response.get("items", [])
    if not items:
        raise HTTPException(status_code=404, detail="Video not found.")

    videos = [video_details(items[0])]

    return {"total_videos": 1, "videos": videos}
