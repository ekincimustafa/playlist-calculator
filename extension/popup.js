const BACKEND_URL = 'https://playlist-backend-6ojq.onrender.com';

let totalSecondsGlobal = 0; 
let videoDataList = [];     

document.addEventListener('DOMContentLoaded', async () => {
    const urlBox = document.getElementById('urlBox');
    const speedRange = document.getElementById('speedRange');
    const speedValue = document.getElementById('speedValue');
    const calcBtn = document.getElementById('calcBtn');
    const resultCard = document.getElementById('resultCard');
    const manageVideosCard = document.getElementById('manageVideosCard');
    const listToggle = document.getElementById('listToggle');
    const listContainer = document.getElementById('videoListContainer');

    let currentUrl = "";
    let currentPId = null;
    let currentVId = null;

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        currentUrl = tabs[0].url;
        currentPId = extractPlaylistId(currentUrl);
        currentVId = extractVideoId(currentUrl);

        if (currentUrl.includes("youtube.com/watch") || currentUrl.includes("youtube.com/playlist")) {
            urlBox.innerText = currentUrl;
            
            chrome.storage.local.get(['savedPId', 'savedVId', 'savedData', 'savedSpeed'], function(result) {
                if ((currentPId && result.savedPId === currentPId) || (!currentPId && currentVId && result.savedVId === currentVId)) {
                    videoDataList = result.savedData || [];
                    if(videoDataList.length > 0) {
                        speedRange.value = result.savedSpeed || 1;
                        speedValue.innerText = `${parseFloat(speedRange.value).toFixed(2)} x`;
                        const newIndex = extractIndex(currentUrl);
                        
                        if (newIndex) {
                            videoDataList.forEach((item, idx) => {
                                if ((idx + 1) < newIndex - 1) {
                                    item.active = false;
                                }
                            });
                            saveExtensionState(currentPId, currentVId);
                        }
                        
                        recalculateTotal();
                        renderVideoList();
                        
                        resultCard.style.display = "block";
                        if (videoDataList.length > 1) manageVideosCard.style.display = "block";
                    }
                }
            });
        } else {
            urlBox.innerText = "Please open a YouTube link.";
            urlBox.style.color = "#dc3545";
            calcBtn.disabled = true;
        }
    });

    speedRange.addEventListener('input', function() {
        speedValue.innerText = `${parseFloat(this.value).toFixed(2)} x`;
        if (totalSecondsGlobal > 0) {
            let activeCount = videoDataList.filter(v => v.active).length;
            updateUI(activeCount);
            saveExtensionState(currentPId, currentVId);
        }
    });

    listToggle.addEventListener('click', () => {
        listToggle.classList.toggle('active');
        if (listContainer.style.maxHeight) {
            listContainer.style.maxHeight = null;
        } else {
            listContainer.style.maxHeight = "280px"; 
        }
    });

    calcBtn.addEventListener('click', async () => {
        if (!currentPId && !currentVId) return;
        if (currentPId && currentPId.startsWith("RD")) {
            if (currentVId) currentPId = null; 
            else { alert("YouTube Mix playlists cannot be calculated."); return; }
        }

        calcBtn.disabled = true;
        calcBtn.innerText = "Processing... ⏳";
        resultCard.style.display = "none";
        manageVideosCard.style.display = "none";
        listContainer.style.maxHeight = null;
        listToggle.classList.remove('active');

        try {
            let data;
            videoDataList = [];

            if (currentPId) {
                const res = await fetch(`${BACKEND_URL}/api/playlist/${currentPId}`);
                if (!res.ok) throw new Error("Backend connection failed.");
                data = await res.json();
            } else {
                const res = await fetch(`${BACKEND_URL}/api/video/${currentVId}`);
                if (!res.ok) throw new Error("Video not found.");
                data = await res.json();
            }

            const currentIndex = extractIndex(currentUrl);

            data.videos.forEach((item, index) => {
                let isVideoActive = true;
                if (currentIndex && (index + 1) < currentIndex - 1) {
                    isVideoActive = false; 
                }

                videoDataList.push({
                    id: item.id,
                    title: item.title,
                    thumb: item.thumbnail || 'https://i.ytimg.com/img/no_thumbnail.jpg',
                    duration: parseDuration(item.duration),
                    active: isVideoActive 
                });
            });

            recalculateTotal();
            renderVideoList();
            saveExtensionState(currentPId, currentVId); 

            resultCard.style.display = "block";
            if (videoDataList.length > 1) {
                manageVideosCard.style.display = "block";
            }

        } catch (error) {
            alert("Error: " + error.message);
        } finally {
            calcBtn.disabled = false;
            calcBtn.innerText = "Calculate Duration";
        }
    });
});

function saveExtensionState(pId, vId) {
    const speed = document.getElementById('speedRange').value;
    chrome.storage.local.set({
        savedPId: pId,
        savedVId: vId,
        savedData: videoDataList,
        savedSpeed: speed
    });
}

function updateUI(activeCount) {
    const speed = parseFloat(document.getElementById('speedRange').value);
    const realDuration = totalSecondsGlobal / speed;

    const h = Math.floor(realDuration / 3600);
    const m = Math.floor((realDuration % 3600) / 60);
    const s = Math.floor(realDuration % 60);
    
    let timeString = "";
    if (h > 0) timeString += `${h}h `;
    timeString += `${m}m ${s}s`;
    
    document.getElementById('totalTimeDisplay').innerText = timeString;
    document.getElementById('videoCount').innerText = activeCount;

    const avg = activeCount > 0 ? realDuration / activeCount : 0;
    const avgM = Math.floor(avg / 60);
    const avgS = Math.floor(avg % 60);
    document.getElementById('avgTime').innerText = `${avgM}m ${avgS}s`;

    const now = new Date();
    const finishDate = new Date(now.getTime() + (realDuration * 1000));
    document.getElementById('finishTime').innerText = finishDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function renderVideoList() {
    const listEl = document.getElementById('videoList');
    if(!listEl) return;
    listEl.innerHTML = ''; 

    videoDataList.forEach((video, index) => {
        const li = document.createElement('li');
        li.className = 'video-item';
        li.onclick = (e) => toggleVideo(index, e);
        
        li.innerHTML = `
            <input type="checkbox" ${video.active ? 'checked' : ''}>
            <img src="${video.thumb}" alt="thumb" loading="lazy">
            <div>
                <span class="v-title">${index + 1}. ${video.title}</span>
                <span class="v-duration">${formatSimpleTime(video.duration)}</span>
            </div>
        `;
        listEl.appendChild(li);
    });
}

function toggleVideo(index, event) {
    if (event.target.type !== 'checkbox') {
        videoDataList[index].active = !videoDataList[index].active;
        renderVideoList(); 
    } else {
        videoDataList[index].active = event.target.checked;
    }
    recalculateTotal(); 
    
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const cUrl = tabs[0].url;
        saveExtensionState(extractPlaylistId(cUrl), extractVideoId(cUrl));
    });
}

function recalculateTotal() {
    let newTotal = 0;
    let activeCount = 0;
    videoDataList.forEach(video => {
        if (video.active) { newTotal += video.duration; activeCount++; }
    });
    totalSecondsGlobal = newTotal; 
    updateUI(activeCount); 
}

function extractPlaylistId(url) {
    const match = url.match(/[&?]list=([^&]+)/);
    return match ? match[1] : null;
}

function extractVideoId(url) {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    return match ? match[1] : null;
}

function extractIndex(url) {
    const match = url.match(/[&?]index=(\d+)/);
    return match ? parseInt(match[1]) : null;
}

function parseDuration(d) {
    const m = d.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!m) return 0;
    const h = (parseInt(m[1]) || 0);
    const min = (parseInt(m[2]) || 0);
    const s = (parseInt(m[3]) || 0);
    return (h * 3600) + (min * 60) + s;
}

function formatSimpleTime(seconds) {
    if (seconds === 0) return "Live";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}