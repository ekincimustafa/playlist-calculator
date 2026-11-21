# Proje durumu

21 Kasım 2026 tarihinde GitHub’daki `main` dalı `10d5b5b` sürümündeydi. Önceki inceleme aynı sürümü temel alıyordu. Başlangıçta 17 frontend ve 42 backend testi geçti.

| Bulgu | Doğrulama ve durum |
| --- | --- |
| Webde üst üste hesaplama | Hesaplama sırasında Enter, devre dışı düğmeyi atlayarak ikinci isteği başlatabiliyordu. Yanıtlar ters sırada tamamlandığında iki istek aynı video listesine yazıyordu. İlk pakette ikinci çağrı, web hesaplama işleyicisinin girişinde engellendi. [Web kodu](../script.js) |
| URL’deki `index` parametresi | Chrome eklentisi `index` değerini yeni hesaplamada ve kayıtlı sonucu yüklerken kullanıyor. Web bu değeri okumuyor. Sonraki hesaplama paketinde ele alınacak. [Eklenti kodu](../extension/popup.js) · [Web kodu](../script.js) |
| Erişilemeyen videoların liste konumu | Backend, `videos` yanıtında dönen öğeleri özgün oynatma listesi konumu olmadan aktarıyor. İstemciler dönen diziyi yeniden numaralandırdığı için eksik videolardan sonraki konumlar kayıyor. Sonraki hesaplama paketinde ele alınacak. [Backend kodu](../backend/main.py) |
| İstek süresi, iptal ve hata deneyimi | Web ve eklenti `fetch` çağrılarında istemci zaman aşımı veya iptal sinyali tanımlamıyor. Hatalar `alert` ile gösteriliyor. Backend’in YouTube bağlantı ve okuma zaman aşımı mevcut. İstemci akışları ikinci aşamada ele alınacak. [Web kodu](../script.js) · [Eklenti kodu](../extension/popup.js) · [Backend kodu](../backend/main.py) |

## İlk paket doğrulaması

- Regresyon testi, ilk isteği bekletip Enter ile başka bir liste göndermeyi deniyor. Düzeltme öncesinde ilk listenin iki videosuna ikinci listeden bir video eklenerek sayı üçe çıkıyordu. Düzeltme sonrasında test ilk listenin süresini, video sayısını, oynatıcısını ve geçmiş kaydını doğruluyor. Test aynı zamanda işlem bitince yeni hesaplama yapılabildiğini gösteriyor.
- Başarısız istekten sonra hesaplama düğmesinin yeniden kullanılabildiği ayrı bir testle doğrulandı.
- Düzeltme sonrası 19 frontend ve 42 backend testi geçti. Testler taklit yanıtlarla çalıştı ve gerçek YouTube kotası kullanılmadı.
- Backend testleri, başlangıç koşusunda da görülen Starlette `TestClient` ve `httpx` kullanım uyarısıyla geçti. Uyarı test bağımlılıklarının bakımında ele alınacak.
- İlk paket `main`e birleştirme veya canlı yayın kapsamına girmiyor. Kalan işler [yol haritasında](ROADMAP.md) izleniyor.
