/**
 * ==========================================
 * YOUTUBE PLAYLIST LENGTH CALCULATOR
 * Core Logic & Custom Backend Integration
 * ==========================================
 */

// --- CONFIGURATION ---

const BACKEND_URL = 'https://playlist-backend-6ojq.onrender.com'; 

// --- DOM ELEMENTS ---
const mainWrapper = document.getElementById('mainWrapper');
const urlInput = document.getElementById('playlistUrl');
const calcBtn = document.getElementById('calcBtn');
const speedInput = document.getElementById('speedRange');
const speedValue = document.getElementById('speedValue');
const videoPlayer = document.getElementById('videoPlayer');

// Time Display Elements
const hoursEl = document.getElementById('hours');
const minutesEl = document.getElementById('minutes');
const secondsEl = document.getElementById('seconds');
const avgEl = document.getElementById('avgVideo');
const videoCountEl = document.getElementById('videoCount');
const finishTimeEl = document.getElementById('finishTime');
const videoListSection = document.getElementById('videoListSection');

// --- GLOBAL STATE ---
let totalSecondsGlobal = 0; 
let videoDataList = [];     

// --- EVENT LISTENERS ---
calcBtn.addEventListener('click', handleCalculation);

urlInput.addEventListener('keypress', (e) => { 
    if(e.key === 'Enter') handleCalculation() 
});

speedInput.addEventListener('input', function() {
    const val = this.value;
    if (speedValue) speedValue.innerHTML = `${parseFloat(val).toFixed(2)} x `; 

    if (totalSecondsGlobal > 0) {
        const currentCount = videoCountEl ? videoCountEl.innerText : 0;
        updateUI(currentCount); 
    }
});

function enableSnapMode() { speedInput.step = '0.25'; }
speedInput.addEventListener('mousedown', enableSnapMode); 
speedInput.addEventListener('touchstart', enableSnapMode); 

/**
 * Main Controller
 */
async function handleCalculation() {
    const url = urlInput.value;
    let playlistId = extractPlaylistId(url);
    const videoId = extractVideoId(url);

    if (!playlistId && !videoId) {
        alert("Please enter a valid YouTube link!");
        return;
    }
 
    if (playlistId && playlistId.startsWith("RD")) {
        if (videoId) {
            playlistId = null; 
        } else {
            alert("YouTube Mix playlists are auto-generated and cannot be calculated. Please enter a standard playlist or video link.");
            return;
        }
    }

    calcBtn.disabled = true;
    calcBtn.innerText = "Processing...";

    const extBtn = document.getElementById('extensionPromoBtn');
    const histBtn = document.getElementById('historyToggleBtn');
    if(extBtn) extBtn.classList.add('shrunk');
    if(histBtn) histBtn.classList.add('shrunk');

    try {
        if (playlistId) {
            embedPlayer(playlistId, 'playlist');
            await fetchFromBackend(playlistId);
        } else {
            embedPlayer(videoId, 'video');
            await fetchSingleVideoFromBackend(videoId); 
        }
        
        mainWrapper.classList.add('expanded');
        document.getElementById('resultSection').style.display = 'flex';
        
        if (playlistId && videoListSection) {
            videoListSection.style.display = 'block';
        } else if (videoListSection) {
            videoListSection.style.display = 'none'; 
        }

        const totalDurationStr = `${hoursEl.innerText}h ${minutesEl.innerText}m ${secondsEl.innerText}s`;
        
        let title = "YouTube Video";
        if (videoDataList.length > 0) {
            if (videoDataList.length > 1) {
                title = "Playlist: " + videoDataList[0].title.substring(0, 30) + "...";
            } else {
                title = videoDataList[0].title.substring(0, 40) + "...";
            }
        }

        saveToHistory(url, title, videoDataList.length, totalDurationStr);

    } catch (error) {
        console.error(error);
        alert("Error: " + error.message);
    } finally {
        calcBtn.disabled = false;
        calcBtn.innerText = "Calculate Duration";
    }
}

// --- UTILITY FUNCTIONS ---

function extractPlaylistId(url) {
    const match = url.match(/[&?]list=([^&]+)/);
    return match ? match[1] : null;
}

function extractVideoId(url) {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    return match ? match[1] : null;
}

function embedPlayer(id, type) {
    const src = type === 'playlist' 
        ? `https://www.youtube.com/embed/videoseries?list=${id}`
        : `https://www.youtube.com/embed/${id}`;
        
    videoPlayer.innerHTML = `<iframe src="${src}" allowfullscreen></iframe>`;
}

async function fetchFromBackend(pid) {
    videoDataList = [];
    
    const res = await fetch(`${BACKEND_URL}/api/playlist/${pid}`);
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.detail || "Failed to fetch playlist data.");
    }
    
    data.videos.forEach(item => {
        videoDataList.push({
            id: item.id,
            title: item.title,
            thumb: item.thumbnail || 'https://i.ytimg.com/img/no_thumbnail.jpg',
            duration: parseDuration(item.duration),
            active: true 
        });
    });

    recalculateTotal(); 
    renderVideoList();  
}

async function fetchSingleVideoFromBackend(vid) {
    videoDataList = [];
    
    const res = await fetch(`${BACKEND_URL}/api/video/${vid}`);
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.detail || "Failed to fetch video data.");
    }

    data.videos.forEach(item => {
        videoDataList.push({
            id: item.id,
            title: item.title,
            thumb: item.thumbnail || 'https://i.ytimg.com/img/no_thumbnail.jpg',
            duration: parseDuration(item.duration),
            active: true 
        });
    });

    recalculateTotal(); 
    renderVideoList();  
}

function parseDuration(d) {
    const m = d.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!m) return 0;
    const h = (parseInt(m[1]) || 0);
    const min = (parseInt(m[2]) || 0);
    const s = (parseInt(m[3]) || 0);
    return (h * 3600) + (min * 60) + s;
}


function updateUI(count) {
    const speed = parseFloat(speedInput.value) || 1; 
    const realDuration = totalSecondsGlobal / speed;

    displayTime(realDuration);

    if (videoCountEl) videoCountEl.innerText = count;
    
    const avg = count > 0 ? totalSecondsGlobal / count : 0;
    const m = Math.floor(avg / 60);
    const s = Math.floor(avg % 60);
    if (avgEl) avgEl.innerText = `${m}m ${s}s`;

    if (finishTimeEl) {
        const now = new Date();
        const finishDate = new Date(now.getTime() + (realDuration * 1000));
        const finishString = finishDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        finishTimeEl.innerText = finishString;
    }
}

function displayTime(sec) {
    hoursEl.innerText = Math.floor(sec / 3600);
    minutesEl.innerText = Math.floor((sec % 3600) / 60);
    secondsEl.innerText = Math.floor(sec % 60);
}

speedValue.addEventListener('click', function() {
    if (this.querySelector('input')) return;

    const currentSpeed = parseFloat(this.innerText); 
    const input = document.createElement('input');
    
    input.type = 'number';
    input.min = '1'; input.max = '5'; input.step = '0.01';
    input.value = currentSpeed;
    input.className = 'speed-input-edit'; 

    this.innerText = '';
    this.appendChild(input);
    input.focus(); 

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') updateCustomSpeed(input.value);
    });
    input.addEventListener('blur', () => updateCustomSpeed(input.value));
    input.addEventListener('click', (e) => e.stopPropagation());
});

function updateCustomSpeed(val) {
    let newSpeed = parseFloat(val);

    if (isNaN(newSpeed)) newSpeed = 1;
    if (newSpeed < 0.25) newSpeed = 0.25;
    if (newSpeed > 5) newSpeed = 5;

    speedInput.step = '0.01'; 
    speedInput.value = newSpeed;

    speedValue.innerHTML = `
        ${newSpeed.toFixed(2)}x
        <svg class="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
    `;

    if (totalSecondsGlobal > 0) {
        displayTime(totalSecondsGlobal / newSpeed);
    }
}

const listToggle = document.getElementById('listToggle');
const listContainer = document.getElementById('videoListContainer');

listToggle.addEventListener('click', () => {
    listToggle.classList.toggle('active');
    
    if (listContainer.style.maxHeight) {
        listContainer.style.maxHeight = null;
    } else {
        listContainer.style.maxHeight = listContainer.scrollHeight + "px";
    }
});

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
            <div class="video-info">
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
}

function recalculateTotal() {
    let newTotal = 0;
    let activeCount = 0;

    videoDataList.forEach(video => {
        if (video.active) {
            newTotal += video.duration;
            activeCount++;
        }
    });

    totalSecondsGlobal = newTotal; 
    updateUI(activeCount); 
}

function formatSimpleTime(seconds) {
    if (seconds === 0) return "Live/Unknown";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const historyToggleBtn = document.getElementById('historyToggleBtn');
    const historyDropdown = document.getElementById('historyDropdown');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    
    if(historyToggleBtn) {
        historyToggleBtn.addEventListener('click', (e) => {
            historyDropdown.classList.toggle('show');
            historyToggleBtn.classList.toggle('active'); 
            e.stopPropagation();
            renderHistory();
        });
    }

    document.addEventListener('click', (e) => {
        if (historyDropdown && historyDropdown.classList.contains('show') && !historyDropdown.contains(e.target)) {
            historyDropdown.classList.remove('show');
            historyToggleBtn.classList.remove('active'); 
        }
    });

    if(clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            localStorage.removeItem('ytPlaylistHistory');
            renderHistory();
        });
    }
});

function saveToHistory(url, title, videoCount, totalDurationStr) {
    let history = JSON.parse(localStorage.getItem('ytPlaylistHistory')) || [];
    history = history.filter(item => item.url !== url);
    
    history.unshift({
        url: url,
        title: title || "YouTube Playlist",
        videoCount: videoCount,
        duration: totalDurationStr,
        date: new Date().toLocaleDateString()
    });

    if (history.length > 10) history.pop();
    localStorage.setItem('ytPlaylistHistory', JSON.stringify(history));
}

function renderHistory() {
    const historyList = document.getElementById('historyList');
    if(!historyList) return;
    
    let history = JSON.parse(localStorage.getItem('ytPlaylistHistory')) || [];
    
    if (history.length === 0) {
        historyList.innerHTML = '<li class="empty-history">No recent history.</li>';
        return;
    }

    historyList.innerHTML = '';
    history.forEach(item => {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.onclick = () => {
            document.getElementById('playlistUrl').value = item.url;
            document.getElementById('historyDropdown').classList.remove('show');
            document.getElementById('historyToggleBtn').classList.remove('active');
            document.getElementById('calcBtn').click();
        };
        
        li.innerHTML = `
            <div class="history-title">${item.title}</div>
            <div class="history-info">${item.videoCount} Videos • ${item.duration}</div>
        `;
        historyList.appendChild(li);
    });
}