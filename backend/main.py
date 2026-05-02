import os
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Kasayı aç ve anahtarı al
load_dotenv()
API_KEY = os.getenv("YOUTUBE_API_KEY")

app = FastAPI()

# GÜVENLİK (CORS): Tarayıcıların "Bu site başka bir sunucudan veri çekiyor, engelle!" 
# demesini önlemek için kendi sitene özel bir izin belgesi oluşturuyoruz.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Şimdilik geliştirme aşamasında her yere açık, canlıya alırken kendi domainini yazacağız.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"mesaj": "Playlist Calculator Backend'i çalışıyor 🚀"}

# ASIL SİHİR BURADA: Sitenin bize playlist ID'si göndereceği adres
@app.get("/api/playlist/{playlist_id}")
def get_playlist_data(playlist_id: str):
    if not API_KEY:
        raise HTTPException(status_code=500, detail="API Key eksik!")

    videos = []
    next_page_token = None

    # YOUTUBE'A GÖSTERECEĞİMİZ SAHTE KİMLİK:
    headers = {
        "referer": "https://ytplaylistcalculator.com/"
    }

    while True:
        pl_url = f"https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId={playlist_id}&key={API_KEY}"
        if next_page_token:
            pl_url += f"&pageToken={next_page_token}"
        
        # Kimliği (headers) ekleyerek kapıyı çalıyoruz
        pl_response = requests.get(pl_url, headers=headers).json()
        
        if "error" in pl_response:
            raise HTTPException(status_code=400, detail=pl_response["error"]["message"])

        video_ids = [item["contentDetails"]["videoId"] for item in pl_response.get("items", [])]
        
        if not video_ids:
            break

        vid_url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id={','.join(video_ids)}&key={API_KEY}"
        
        # Buraya da kimliği ekliyoruz
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