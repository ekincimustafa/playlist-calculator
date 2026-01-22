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
const videoListSection = document.getElementById('videoListSection');
let totalSecondsGlobal = 0;
let videoDataList = []; // <--- YENİ: Tüm videoları burada tutacağız
/* --- OLAY DİNLEYİCİLERİ --- */
calcBtn.addEventListener('click', handleCalculation);

// Enter tuşuna basınca da çalışsın
urlInput.addEventListener('keypress', (e) => { 
    if(e.key === 'Enter') handleCalculation() 
});

// Slider değişince anlık güncelleme
speedInput.addEventListener('input', function() {
    const val = this.value;
    
    // Rozeti güncelle
    if (speedValue) speedValue.innerHTML = `${parseFloat(val).toFixed(2)} x `; // (Senin ikon kodun burada kalsın)

    // Eğer hesaplama yapılmışsa tüm ekranı (Finish At dahil) güncelle
    if (totalSecondsGlobal > 0) {
        // Video sayısını mevcut ekrandan alıp fonksiyona geri veriyoruz
        const currentCount = videoCountEl ? videoCountEl.innerText : 0;
        updateUI(currentCount); 
    }
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
        
        if (playlistId && videoListSection) {
            videoListSection.style.display = 'block';
        } else if (videoListSection) {
            videoListSection.style.display = 'none'; // Tek video ise sakla
        }
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

// 1. PLAYLIST İÇİN
async function fetchPlaylistData(pid) {
    let nextToken = '';
    videoDataList = []; // Listeyi sıfırla
    let videos = [];

    // A) Videoların Başlık, Resim ve ID'lerini topla
    do {
        // snippet = Başlık/Resim, contentDetails = ID
        const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${pid}&key=${API_KEY}&pageToken=${nextToken}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        data.items.forEach(item => {
            // Silinmiş videoları listeye alma
            const title = item.snippet.title;
            if (title !== "Private video" && title !== "Deleted video") {
                videos.push({
                    id: item.contentDetails.videoId,
                    title: item.snippet.title,
                    thumb: item.snippet.thumbnails?.default?.url || 'https://i.ytimg.com/img/no_thumbnail.jpg',
                    duration: 0, // Birazdan öğreneceğiz
                    active: true // Varsayılan olarak seçili
                });
            }
        });
        nextToken = data.nextPageToken || '';
    } while (nextToken);

    // B) Bu videoların sürelerini (Duration) çek
    // YouTube API en fazla 50 ID kabul eder, parça parça soracağız.
    for (let i = 0; i < videos.length; i += 50) {
        const chunk = videos.slice(i, i + 50);
        const videoIds = chunk.map(v => v.id).join(',');

        const vidResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${API_KEY}`);
        const vidData = await vidResponse.json();

        vidData.items.forEach(item => {
            const duration = parseDuration(item.contentDetails.duration);
            // Süreyi doğru videoya eşleştir
            const video = videos.find(v => v.id === item.id);
            if (video) video.duration = duration;
        });
    }

    // C) Global listeyi güncelle ve Hesapla
    videoDataList = videos;
    recalculateTotal(); // Toplamı hesapla ve UI'ı güncelle
    renderVideoList();  // Listeyi ekrana bas
}

// 2. TEK VİDEO İÇİN
async function fetchSingleVideoData(vid) {
    videoDataList = []; // Sıfırla

    // Video detaylarını çek
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

/* --- ACCORDION AÇ/KAPA MANTIĞI --- */
const listToggle = document.getElementById('listToggle');
const listContainer = document.getElementById('videoListContainer');

listToggle.addEventListener('click', () => {
    listToggle.classList.toggle('active');
    
    if (listContainer.style.maxHeight) {
        // Zaten açıksa kapat
        listContainer.style.maxHeight = null;
    } else {
        // Kapalıysa aç (İçeriğin boyutu kadar yer aç)
        listContainer.style.maxHeight = listContainer.scrollHeight + "px";
    }
});

/* --- LİSTE VE HESAPLAMA YÖNETİMİ --- */

// 1. Listeyi HTML'e Dönüştür
function renderVideoList() {
    const listEl = document.getElementById('videoList');
    if(!listEl) return;
    
    listEl.innerHTML = ''; // Temizle

    videoDataList.forEach((video, index) => {
        const li = document.createElement('li');
        li.className = 'video-item';
        // Satıra tıklayınca da seç/bırak yapsın
        li.onclick = (e) => toggleVideo(index, e);

        // HTML Yapısı
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

// 2. Video Seç/Bırak (Checkbox)
function toggleVideo(index, event) {
    // Checkbox'a basıldıysa (otomatik değişir), satıra basıldıysa biz değiştiririz
    if (event.target.type !== 'checkbox') {
        videoDataList[index].active = !videoDataList[index].active;
        renderVideoList(); // Görseli güncelle
    } else {
        videoDataList[index].active = event.target.checked;
    }
    recalculateTotal(); // Süreyi yeniden hesapla
}

// 3. Toplam Süreyi Yeniden Hesapla (Sadece Seçililer)
function recalculateTotal() {
    let newTotal = 0;
    let activeCount = 0;

    videoDataList.forEach(video => {
        if (video.active) {
            newTotal += video.duration;
            activeCount++;
        }
    });

    totalSecondsGlobal = newTotal; // Global süreyi güncelle
    updateUI(activeCount); // Ekranı güncelle (Count, Avg, Finish At hepsi burada)
}

// 4. Liste İçin Basit Süre Formatı (12:30 gibi)
function formatSimpleTime(seconds) {
    if (seconds === 0) return "Live/Unknown";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}