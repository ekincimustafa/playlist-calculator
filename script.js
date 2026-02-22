/**
 * ==========================================
 * YOUTUBE PLAYLIST LENGTH CALCULATOR
 * Core Logic & API Integration
 * ==========================================
 */

// --- CONFIGURATION ---
// Note: API Key is restricted via Google Cloud Console (HTTP Referrers & Quotas)
const API_KEY = 'AIzaSyDZEQ482r7Ofg06PePEP7VnCW_VcG7pk78';

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
let totalSecondsGlobal = 0; // Stores the base duration of all active videos
let videoDataList = [];     // Array storing metadata for each video {id, title, duration, active}

// --- EVENT LISTENERS ---
calcBtn.addEventListener('click', handleCalculation);

urlInput.addEventListener('keypress', (e) => { 
    if(e.key === 'Enter') handleCalculation() 
});

// Real-time speed adjustment using the slider
speedInput.addEventListener('input', function() {
    const val = this.value;
    if (speedValue) speedValue.innerHTML = `${parseFloat(val).toFixed(2)} x `; 

    if (totalSecondsGlobal > 0) {
        const currentCount = videoCountEl ? videoCountEl.innerText : 0;
        updateUI(currentCount); 
    }
});

// Enable precise snapping for mobile/touch users
function enableSnapMode() { speedInput.step = '0.25'; }
speedInput.addEventListener('mousedown', enableSnapMode); 
speedInput.addEventListener('touchstart', enableSnapMode); 

/**
 * Main Controller: Handles the input, triggers fetching, and updates UI layout.
 */
async function handleCalculation() {
    const url = urlInput.value;
    const playlistId = extractPlaylistId(url);
    const videoId = extractVideoId(url);

    if (!playlistId && !videoId) {
        alert("Please enter a valid YouTube link!");
        return;
    }

    // UI Loading State
    calcBtn.disabled = true;
    calcBtn.innerText = "Processing...";

    try {
        if (playlistId) {
            embedPlayer(playlistId, 'playlist');
            await fetchPlaylistData(playlistId);
        } else {
            embedPlayer(videoId, 'video');
            await fetchSingleVideoData(videoId);
        }
        
        // Expand UI to show results
        mainWrapper.classList.add('expanded');
        document.getElementById('resultSection').style.display = 'flex';
        
        // Show Video Management list only for playlists
        if (playlistId && videoListSection) {
            videoListSection.style.display = 'block';
        } else if (videoListSection) {
            videoListSection.style.display = 'none'; 
        }
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

/**
 * Fetches playlist items and calculates duration in chunks of 50 (API limit).
 * @param {string} pid - YouTube Playlist ID
 */
async function fetchPlaylistData(pid) {
    let nextToken = '';
    videoDataList = [];
    let videos = [];

    // Step 1: Collect Video IDs, Titles, and Thumbnails
    do {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${pid}&key=${API_KEY}&pageToken=${nextToken}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        data.items.forEach(item => {
            const title = item.snippet.title;
            // Exclude unavailable videos
            if (title !== "Private video" && title !== "Deleted video") {
                videos.push({
                    id: item.contentDetails.videoId,
                    title: item.snippet.title,
                    thumb: item.snippet.thumbnails?.default?.url || 'https://i.ytimg.com/img/no_thumbnail.jpg',
                    duration: 0, 
                    active: true 
                });
            }
        });
        nextToken = data.nextPageToken || '';
    } while (nextToken);

    // Step 2: Fetch actual durations for collected IDs (Batched requests)
    for (let i = 0; i < videos.length; i += 50) {
        const chunk = videos.slice(i, i + 50);
        const videoIds = chunk.map(v => v.id).join(',');

        const vidResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${API_KEY}`);
        const vidData = await vidResponse.json();

        vidData.items.forEach(item => {
            const duration = parseDuration(item.contentDetails.duration);
            const video = videos.find(v => v.id === item.id);
            if (video) video.duration = duration;
        });
    }

    videoDataList = videos;
    recalculateTotal(); 
    renderVideoList();  
}

async function fetchSingleVideoData(vid) {
    videoDataList = [];

    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${vid}&key=${API_KEY}`);
    const data = await res.json();
    
    if (data.items.length > 0) {
        const item = data.items[0];
        videoDataList.push({
            id: item.id,
            title: item.snippet.title,
            thumb: item.snippet.thumbnails?.default?.url || '',
            duration: parseDuration(item.contentDetails.duration),
            active: true
        });
    }

    recalculateTotal();
    renderVideoList();
}

/**
 * Converts ISO 8601 duration format (e.g., PT1H2M10S) to total seconds.
 */
function parseDuration(d) {
    const m = d.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!m) return 0;
    const h = (parseInt(m[1]) || 0);
    const min = (parseInt(m[2]) || 0);
    const s = (parseInt(m[3]) || 0);
    return (h * 3600) + (min * 60) + s;
}

/**
 * Updates all DOM elements related to calculations (Time, Avg, Finish At)
 */
function updateUI(count) {
    const speed = parseFloat(speedInput.value) || 1; 
    const realDuration = totalSecondsGlobal / speed;

    displayTime(realDuration);

    if (videoCountEl) videoCountEl.innerText = count;
    
    // Average Video Time
    const avg = count > 0 ? totalSecondsGlobal / count : 0;
    const m = Math.floor(avg / 60);
    const s = Math.floor(avg % 60);
    if (avgEl) avgEl.innerText = `${m}m ${s}s`;

    // "Finish At" Prediction
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

// --- CUSTOM SPEED LOGIC ---

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

// --- VIDEO LIST & TOGGLE MANAGEMENT ---

const listToggle = document.getElementById('listToggle');
const listContainer = document.getElementById('videoListContainer');

// Accordion animation
listToggle.addEventListener('click', () => {
    listToggle.classList.toggle('active');
    
    if (listContainer.style.maxHeight) {
        listContainer.style.maxHeight = null;
    } else {
        listContainer.style.maxHeight = listContainer.scrollHeight + "px";
    }
});

/**
 * Renders the video selection list in the DOM.
 */
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

/**
 * Includes or excludes a video from the calculation when clicked.
 */
function toggleVideo(index, event) {
    if (event.target.type !== 'checkbox') {
        videoDataList[index].active = !videoDataList[index].active;
        renderVideoList(); 
    } else {
        videoDataList[index].active = event.target.checked;
    }
    recalculateTotal(); 
}

/**
 * Recalculates the global duration based only on 'active' videos.
 */
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