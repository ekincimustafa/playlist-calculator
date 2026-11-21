# Proje durumu

21 Kasım 2026 tarihinde GitHub’daki `main` dalı `10d5b5b` sürümündeydi. Önceki inceleme aynı sürümü temel alıyordu. Başlangıçta 17 frontend ve 42 backend testi geçti.

| Bulgu | Doğrulama ve durum |
| --- | --- |
| Webde üst üste hesaplama | Hesaplama sırasında Enter, devre dışı düğmeyi atlayarak ikinci isteği başlatabiliyordu. Yanıtlar ters sırada tamamlandığında iki istek aynı video listesine yazıyordu. İlk pakette ikinci çağrı, web hesaplama işleyicisinin girişinde engellendi. [Web kodu](../script.js) |
| URL’deki `index` parametresi | İkinci pakette iki istemci de pozitif tam sayı `index` değerini özgün, 1 tabanlı `position` ile karşılaştırıyor. Tek video bağlantılarında `index` hesaba katılmıyor. [Eklenti kodu](../extension/popup.js) · [Web kodu](../script.js) |
| Erişilemeyen videoların liste konumu | İkinci pakette backend playlist girişlerinin sırasını izliyor, tekrarları koruyor ve erişilebilen her girişe özgün 1 tabanlı `position` ekliyor. İstemciler bu konumu gösteriyor. [Backend kodu](../backend/main.py) |
| İstek süresi, iptal ve hata deneyimi | Web ve eklenti `fetch` çağrılarında istemci zaman aşımı veya iptal sinyali tanımlamıyor. Hatalar `alert` ile gösteriliyor. Backend’in YouTube bağlantı ve okuma zaman aşımı mevcut. İstemci akışları ikinci aşamada ele alınacak. [Web kodu](../script.js) · [Eklenti kodu](../extension/popup.js) · [Backend kodu](../backend/main.py) |

## İlk paket doğrulaması

- Regresyon testi, ilk isteği bekletip Enter ile başka bir liste göndermeyi deniyor. Düzeltme öncesinde ilk listenin iki videosuna ikinci listeden bir video eklenerek sayı üçe çıkıyordu. Düzeltme sonrasında test ilk listenin süresini, video sayısını, oynatıcısını ve geçmiş kaydını doğruluyor. Test aynı zamanda işlem bitince yeni hesaplama yapılabildiğini gösteriyor.
- Başarısız istekten sonra hesaplama düğmesinin yeniden kullanılabildiği ayrı bir testle doğrulandı.
- Düzeltme sonrası 19 frontend ve 42 backend testi geçti. Testler taklit yanıtlarla çalıştı ve gerçek YouTube kotası kullanılmadı.
- Backend testleri, başlangıç koşusunda da görülen Starlette `TestClient` ve `httpx` kullanım uyarısıyla geçti. Uyarı test bağımlılıklarının bakımında ele alınacak.
- PR #6’nın başı incelenen `cad032f` olarak doğrulandı ve kullanıcının yetkisiyle `ebe0cdc` commit’i üzerinden `main`e birleştirildi. [GitHub Pages çalışması](https://github.com/ekincimustafa/playlist-calculator/actions/runs/44881954342) build ve deploy adımlarını başarıyla tamamladı.


## İkinci paket

- Dal `codex/preserve-playlist-positions`, PR #6 sonrasındaki güncel `main` (`ebe0cdc`) üzerinden açıldı.
- Backend, YouTube detaylarını video kimliğine göre eşliyor ve sonuçları playlist girişleri üzerinden oluşturuyor. Aynı videonun her tekrarı ayrı giriş olarak kalıyor. YouTube’un sıfır tabanlı `snippet.position` değeri yanıtta 1 tabanlı `position` olarak aktarılıyor. Bu alan eksikse tüm playlist girişlerini sayan, sayfalar boyunca devam eden konum kullanılıyor. Erişilemeyen videolar süre hesabına katılmıyor ve sonraki videoların konumlarını kaydırmıyor. `total_videos` erişilebilen girişlerin sayısını vermeye devam ediyor.
- Web ve eklenti `index` değerinden önceki girişleri seçimsiz başlatıyor. Geçersiz, sıfır, negatif, kesirli veya güvenli tam sayı sınırını aşan değerler yok sayılıyor. Listenin sonrasındaki bir index sıfır video seçiyor. Tek video hesaplaması index değerinden etkilenmiyor.
- Yeni eklenti kayıtlarında özgün konumlar saklanıyor. Konum bilgisi olmayan eski playlist kayıtları gösterilmiyor. Kullanıcı hesaplama düğmesine bastığında güncel veri alınıyor ve kayıt yenileniyor. Kayıtlı hız korunuyor. Eski tek video kayıtları kullanılabiliyor. Geçerli konumlu playlist kaydını yüklemek ağ isteği gerektirmiyor ve elle kaldırılmış seçimleri koruyor.
- API’ye eklenen `position` alanı eski istemcilerle uyumlu. Yeni istemciler eski backend yanıtlarını dizi konumuyla işleyebiliyor. Eksik video konumlarının tam doğruluğu için backend’in bu paketteki sürümü gerekli.
- Regresyon kapsamı detay yanıtının sırası, aynı ve farklı sayfalardaki tekrarlar, erişilemeyen bir sayfadan sonraki konumlar, geçersiz konum verisi, iki istemcide index sınırları, tek video, eski kayıtlar ve kayıtlı seçimleri içeriyor. Seçilen beş frontend regresyonu eski main üzerinde başarısız oldu.
- Son doğrulamada 26 frontend ve 45 backend testi geçti. Gerçek YouTube kotası kullanılmadı. Mevcut Starlette ve httpx kullanım uyarısı sürüyor.
- İkinci paket ayrı PR’da incelemeye sunulacak. Sıradaki iş istemci isteklerinin zaman aşımı, iptal, bekleme ve hata deneyimi. Diğer aşamalar [yol haritasında](ROADMAP.md) izleniyor.
