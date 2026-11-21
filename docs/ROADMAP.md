# Yol haritası

1. **Hesaplama doğruluğu ve web/eklenti tutarlılığı.** İlk pakette webde Enter ile üst üste hesaplama başlatılmasını önle. Sonraki paketlerde erişilemeyen videolara rağmen özgün oynatma listesi konumlarını koru ve `index` parametresinden başlayan hesaplamayı web ile eklenti arasında tutarlı hâle getir.
2. **Hata ve bekleme deneyimi.** Üçüncü paket [PR #8](https://github.com/ekincimustafa/playlist-calculator/pull/8) üzerinden incelemeye açık. Web ve eklenti isteklerine zaman aşımı ve iptal davranışı ekle. Bekleme, hata ve yeniden deneme durumlarını kullanıcıya anlaşılır biçimde göster.
3. **Otomatik testler ve bakım.** Dördüncü paket [PR #9](https://github.com/ekincimustafa/playlist-calculator/pull/9) üzerinden incelemeye açık. Yeni hesaplama ve hata akışlarının regresyon kapsamını tamamla. Test bağımlılıkları ve çalıştırma talimatlarındaki bakım ihtiyaçlarını ele al.
4. **Güvenlik incelemesi ve düzeltmeler.** Sıradaki paket. Web, eklenti ve backend’deki mevcut kontrolleri gözden geçir. Doğrulanan bulgulara göre düzeltmeleri önceliklendir.
5. **Yeni özellikler.** Kapsamı ve öncelikleri proje sahibiyle birlikte belirle.
6. **Marka ve SEO.** Önceki aşamaların ardından marka ve SEO işlerini planla.

Regresyon testlerini ilgili değişiklikle birlikte ekle. Güncel bulgular ve test sonuçları [durum kaydında](STATUS.md) yer alır.
