/* --- AYARLAR --- */
const API_KEY = 'AIzaSyDZEQ482r7Ofg06PePEP7VnCW_VcG7pk78';

/* --- DOM ELEMENTLERİ --- */
const mainWrapper = document.getElementById('mainWrapper');
const urlInput = document.getElementById('playlistUrl');
const calcBtn = document.getElementById('calcBtn');
const speedInput = document.getElementById('speedRange');
const speedValue = document.getElementById('speedValue');
const videoPlayer = document.getElementById('videoPlayer');

// Sonuç Alanları
const hoursEl = document.getElementById('hours');
const minutesEl = document.getElementById('minutes');
const secondsEl = document.getElementById('seconds');
const avgEl = document.getElementById('avgVideo');
// İŞTE BU EKSİKTİ: Video sayısını yazacağımız alanı buraya tanıtıyoruz
const videoCountEl = document.getElementById('videoCount');
// Finish at
const finishTimeEl = document.getElementById('finishTime');

let totalSecondsGlobal = 0;

/* --- OLAY DİNLEYİCİLERİ --- */
calcBtn.addEventListener('click', handleCalculation);

// Enter tuşuna basınca da çalışsın
urlInput.addEventListener('keypress', (e) => { 
    if(e.key === 'Enter') handleCalculation() 
});

// Slider değişince anlık güncelleme
speedInput.addEventListener('input', function() {
    const speed = parseFloat(this.value);
    speedValue.innerText = speed.toFixed(2) + 'x';
    // Eğer hesaplama yapılmışsa sonucu yeni hıza göre güncelle
    if (totalSecondsGlobal > 0) displayTime(totalSecondsGlobal / speed);
});

/* --- SLIDER MODU (SNAP) --- */
// Kullanıcı slider'a tıkladığı veya dokunduğu an "Küt Küt" moduna geç
function enableSnapMode() {
    speedInput.step = '0.25';
}

speedInput.addEventListener('mousedown', enableSnapMode); // PC için
speedInput.addEventListener('touchstart', enableSnapMode); // Telefon için

/* --- ANA HESAPLAMA FONKSİYONU --- */
async function handleCalculation() {
    const url = urlInput.value;
    const playlistId = extractPlaylistId(url);
    const videoId = extractVideoId(url);

    // Ne playlist ne de video ID'si bulamazsa hata ver
    if (!playlistId && !videoId) {
        alert("Please enter a valid YouTube link!");
        return;
    }

    calcBtn.disabled = true;
    calcBtn.innerText = "Processing...";

    try {
        if (playlistId) {
            // --- SENARYO 1: PLAYLIST ---
            embedPlayer(playlistId, 'playlist');
            await fetchPlaylistData(playlistId);
        } else {
            // --- SENARYO 2: TEK VIDEO ---
            embedPlayer(videoId, 'video');
            await fetchSingleVideoData(videoId);
        }
        
        // İşlem bitince ekranı genişlet
        mainWrapper.classList.add('expanded');
        document.getElementById('resultSection').style.display = 'flex';

    } catch (error) {
        console.error(error);
        alert("Error: " + error.message);
    } finally {
        calcBtn.disabled = false;
        calcBtn.innerText = "Calculate Duration";
    }
}

/* --- YARDIMCI FONKSİYONLAR (Linkten ID Çıkarma) --- */
function extractPlaylistId(url) {
    const match = url.match(/[&?]list=([^&]+)/);
    return match ? match[1] : null;
}

function extractVideoId(url) {
    // Hem uzun (v=) hem kısa (youtu.be/) linkleri destekler
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    return match ? match[1] : null;
}

/* --- VİDEO OYNATICIYI GÖMME --- */
function embedPlayer(id, type) {
    const src = type === 'playlist' 
        ? `https://www.youtube.com/embed/videoseries?list=${id}`
        : `https://www.youtube.com/embed/${id}`;
        
    videoPlayer.innerHTML = `<iframe src="${src}" allowfullscreen></iframe>`;
}

/* --- VERİ ÇEKME İŞLEMLERİ --- */
async function fetchPlaylistData(pid) {
    let nextToken = '', videoIds = [];
    totalSecondsGlobal = 0;

    // 1. Tüm video ID'lerini topla (Sayfalama yaparak)
    do {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${pid}&key=${API_KEY}&pageToken=${nextToken}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        
        data.items.forEach(item => videoIds.push(item.contentDetails.videoId));
        nextToken = data.nextPageToken || '';
    } while (nextToken);

    // 2. Bu ID'lerin sürelerini çek
    for (let i = 0; i < videoIds.length; i += 50) {
        const chunk = videoIds.slice(i, i+50).join(',');
        await fetchVideoDurations(chunk);
    }
    
    // Ekrana bas
    updateUI(videoIds.length);
}

// Tek video için veri çekme
async function fetchSingleVideoData(vid) {
    totalSecondsGlobal = 0;
    await fetchVideoDurations(vid);
    updateUI(1); // Sayı her zaman 1'dir
}

// Ortak süre çekme fonksiyonu
async function fetchVideoDurations(ids) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${API_KEY}`);
    const data = await res.json();
    data.items.forEach(item => {
        totalSecondsGlobal += parseDuration(item.contentDetails.duration);
    });
}

/* --- ZAMAN HESAPLAMA VE FORMATLAMA --- */
function parseDuration(d) {
    const m = d.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!m) return 0;
    const h = (parseInt(m[1]) || 0);
    const min = (parseInt(m[2]) || 0);
    const s = (parseInt(m[3]) || 0);
    return (h * 3600) + (min * 60) + s;
}

/* --- EKRANI GÜNCELLEME (Sorunun Çözüldüğü Yer) --- */
/* --- EKRANI GÜNCELLEME FONKSİYONU --- */
function updateUI(count) {
    // 1. Güncel hızı al
    const speed = parseFloat(speedInput.value) || 1; // Hata olursa 1 varsay
    
    // 2. Hıza göre toplam gerçek süreyi hesapla
    const realDuration = totalSecondsGlobal / speed;

    // 3. Toplam süreyi ekrana yaz (Saat, Dakika, Saniye kutuları)
    displayTime(realDuration);
    
    // 4. Video sayısını yaz
    if (videoCountEl) {
        videoCountEl.innerText = count;
    }
    
    // 5. Ortalama süreyi hesapla ve yaz
    const avg = count > 0 ? totalSecondsGlobal / count : 0;
    const m = Math.floor(avg / 60);
    const s = Math.floor(avg % 60);
    if (avgEl) {
        avgEl.innerText = `${m}m ${s}s`;
    }

    /* --- YENİ: FINISH AT (Bitiş Saati) HESAPLAMA --- */
    // Eğer finishTimeEl elementi HTML'de varsa hesapla
    if (finishTimeEl) {
        const now = new Date();
        // Şu anki zamana kalan süreyi (milisaniye olarak) ekle
        const finishDate = new Date(now.getTime() + (realDuration * 1000));
        
        // Saati güzel formatla (Örn: 14:30)
        const finishString = finishDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Ekrana yaz
        finishTimeEl.innerText = finishString;
    }
}

function displayTime(sec) {
    hoursEl.innerText = Math.floor(sec / 3600);
    minutesEl.innerText = Math.floor((sec % 3600) / 60);
    secondsEl.innerText = Math.floor(sec % 60);
}

/* --- CUSTOM SPEED ÖZELLİĞİ --- */

// 1. Hız rozetine tıklama olayı
speedValue.addEventListener('click', function() {
    // Eğer zaten input varsa (kullanıcı art arda tıklarsa) işlem yapma
    if (this.querySelector('input')) return;

    const currentSpeed = parseFloat(this.innerText); // Mevcut hızı al (Örn: 1.50)

    // Dinamik olarak bir input oluştur
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '5';
    input.step = '0.01';
    input.value = currentSpeed;
    input.className = 'speed-input-edit'; // CSS sınıfını ekle

    // Rozetin içini temizle ve inputu koy
    this.innerText = '';
    this.appendChild(input);
    input.focus(); // İmleci içine odakla

    // --- Olaylar ---
    // 1. Enter tuşuna basılırsa onayla
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') updateCustomSpeed(input.value);
    });

    // 2. Kutunun dışına tıklanırsa onayla (Blur)
    input.addEventListener('blur', () => updateCustomSpeed(input.value));
    
    // 3. Tıklama slider'a yayılmasın (Event Bubbling'i durdur)
    input.addEventListener('click', (e) => e.stopPropagation());
});

// Hızı güncelleyen ve UI'ı düzelten fonksiyon
function updateCustomSpeed(val) {
    let newSpeed = parseFloat(val);

    // Validasyon
    if (isNaN(newSpeed)) newSpeed = 1;
    if (newSpeed < 0.25) newSpeed = 0.25;
    if (newSpeed > 5) newSpeed = 5;

    // --- KRİTİK NOKTA BURASI ---
    // Elle girilen değeri slider'da gösterebilmek için hassasiyeti artırıyoruz
    speedInput.step = '0.01'; 
    speedInput.value = newSpeed;

    // Rozeti ve İkonu Güncelle
    speedValue.innerHTML = `
        ${newSpeed.toFixed(2)}x
        <svg class="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
    `;

    // Hesaplama yapılmışsa sonucu güncelle
    if (totalSecondsGlobal > 0) {
        displayTime(totalSecondsGlobal / newSpeed);
    }
}