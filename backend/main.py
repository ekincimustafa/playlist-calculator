import os
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
API_KEY = os.getenv("YOUTUBE_API_KEY")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Playlist Calculator Backend is running 🚀"}

@app.get("/api/playlist/{playlist_id}")
def get_playlist_data(playlist_id: str):
    if not API_KEY:
        raise HTTPException(status_code=500, detail="API Key is missing!")

    if playlist_id.startswith("RD"):
        raise HTTPException(status_code=400, detail="YouTube Mix playlists are auto-generated and not supported by the API.")

    videos = []
    next_page_token = None
    headers = {"referer": "https://ytplaylistcalculator.com/"}

    while True:
        pl_url = f"https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId={playlist_id}&key={API_KEY}"
        if next_page_token:
            pl_url += f"&pageToken={next_page_token}"
        
        pl_response = requests.get(pl_url, headers=headers).json()
        
        if "error" in pl_response:
            raise HTTPException(status_code=400, detail=pl_response["error"]["message"])

        video_ids = [item["contentDetails"]["videoId"] for item in pl_response.get("items", [])]
        
        if not video_ids:
            break

        vid_url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id={','.join(video_ids)}&key={API_KEY}"
        vid_response = requests.get(vid_url, headers=headers).json()

        for item in vid_response.get("items", []):
            videos.append({
                "id": item["id"],
                "title": item["snippet"]["title"],
                "duration": item["contentDetails"]["duration"], 
                "thumbnail": item["snippet"]["thumbnails"].get("medium", {}).get("url", "")
            })

        next_page_token = pl_response.get("nextPageToken")
        if not next_page_token:
            break

    return {"total_videos": len(videos), "videos": videos}

@app.get("/api/video/{video_id}")
def get_single_video_data(video_id: str):
    if not API_KEY:
        raise HTTPException(status_code=500, detail="API Key is missing!")

    headers = {"referer": "https://ytplaylistcalculator.com/"}
    vid_url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id={video_id}&key={API_KEY}"
    
    vid_response = requests.get(vid_url, headers=headers).json()
    
    if "error" in vid_response:
        raise HTTPException(status_code=400, detail=vid_response["error"]["message"])

    items = vid_response.get("items", [])
    if not items:
        raise HTTPException(status_code=404, detail="Video not found.")

    item = items[0]
    videos = [{
        "id": item["id"],
        "title": item["snippet"]["title"],
        "duration": item["contentDetails"]["duration"],
        "thumbnail": item["snippet"]["thumbnails"].get("medium", {}).get("url", "")
    }]

    return {"total_videos": 1, "videos": videos}