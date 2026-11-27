# Trafik ve marka geliştirme planı

27 Kasım 2026. Başlangıç kodu: `347436923984342b00b2bbed93b50c147e8e1619`.

## Amaç ve ilk kapsam

Kullanıcı trafik ve marka geliştirme çalışmalarının başlamasını istedi. İngilizce sürüm temel alınacak. Geri alınan çoklu dil paketi yeniden eklenmeyecek. İlk paket başlık, açıklama, canonical, paylaşım metinleri ve WebSite kimliğini düzenler. Bu değişikliklerin tek başına sıralama veya trafik artışı sağlayacağı varsayılmıyor.

Sorgu/ülke öncelikleri, gerçek mobil deneyim, güncel Analytics sonuçları ve Google'ın seçtiği canonical henüz bu çalışmada doğrulanmadı. Arama aracının getirdiği ana sayfa metni eski dil menüsünü de içerdiği için canlı yayın sürümünün kanıtı sayılmadı; kaynak incelemesi yukarıdaki commit'e dayanıyor.

## 1. Başlangıç verisini kaydet

Search Console'da doğru domain özelliğini seç. Performans > Arama sonuçları raporunda arama türünü Web, tarihi son 3 ay olarak ayarla. Son 28 günü ayrıca incele. Kullanılabilir tarih aralığı ve filtreleri kayıtla birlikte sakla.

İstenen veriler:
- Toplam tıklama, gösterim, CTR ve ortalama konum.
- Sorgular: mümkünse ilk 20; başlangıç için ilk 5 yeterli. Her sorgu için tıklama, gösterim, CTR ve konum.
- Ülkeler: ilk 5 ve mümkünse tıklama/gösterim.
- Sayfalar: hangi URL'lerin trafik aldığı.
- Cihazlar: mobil ve masaüstü dağılımı.
- URL Denetimi: ana sayfanın dizin durumu, Google'ın seçtiği canonical ve son tarama.

Search Console doğrudan dil raporu sunuyormuş gibi yorumlanmayacak. Ülkeler dil tercihiyle eşitlenmeyecek. Sorgu tablosundaki anonimleştirme ve eksik sorgular nedeniyle toplamlar birebir eşleşmeyebilir.

Analytics'te aynı dönem için trafik kaynağı, açılış sayfası, cihaz ve tarayıcı dili incelenecek. Bot, kendi testlerimiz, ölçüm engelleri ve küçük örnekler değerlendirmede dikkate alınacak. Özel hesap verilerine bu oturumda erişim sağlanmadı.

## 2. Fırsatları seç

| Gözlem | İlk inceleme |
| --- | --- |
| İlgili sorgu gösterim alıyor, benzer konum/cihaz koşullarında az tıklanıyor | Başlık, arama niyeti ve görünen açıklama |
| Mobilde hesaplama daha az başlatılıyor | Giriş alanı, hız kontrolü ve ilk ekran |
| İstekler başlıyor fakat sonuç alınamıyor | Hata türleri, süre ve servis yanıtı |
| Belirli sorgular mevcut özelliklerle tam örtüşüyor | Kısa kullanım açıklaması veya örnek |
| İlgili bir dilde talep kanıtı oluşuyor | Daha sonra tek dilde ayrı URL pilotu |

Her düşük CTR değeri metin sorunu değildir; sıra, cihaz ve sorgu türü birlikte ele alınmalı. İyileştirmeler önce/sonra karşılaştırılabilir, ancak değişimin tamamı tek güncellemeye bağlanmayacak.

## 3. Ölçümü ikinci bir küçük paket olarak hazırla

Mevcut Google Analytics etiketine ek olarak hesaplama başlangıcı, başarı, hata ve iptal olaylarının gerekliliğini koddan doğrula. Bu ilk pakette yeni izleme davranışı eklenmedi.

Önerilen olaylar: `calculation_start`, `calculation_success`, `calculation_error`, `calculation_cancel`.
- Tek deneme için doğru sayım; çift Enter ve yeniden denemede yinelenen başarı olmaması.
- Hata olaylarında sabit kod; kullanıcı URL'si, video kimliği ve başlığı göndermeme.
- Başlama oranı: hesaplama başlatılan oturum / uygun oturum.
- Tamamlama oranı: başarılı deneme / başlatılan deneme.
- Bekleme süresi ve hata oranıyla birlikte inceleme.
- Yayından önce taklit API/Analytics ile doğrulama.

## 4. İçerik ve marka

Sorgu verisine göre kısa bir kullanım anlatımı ve gerekli sorular seçilecek. Aday konular: toplam süre, oynatma hızının etkisi, seçili videolar ve erişilemeyen videolar. Yanıtlar backend ve istemci davranışıyla doğrulanmadan yayımlanmayacak.

Mevcut marka temel alınacak: `YTPlaylistCalculator`, alan adı `ytplaylistcalculator.com`. Yeniden adlandırma yapılmayacak. Site, eklenti mağazası ve paylaşım görsellerindeki tutarlılık sonraki incelemede kontrol edilecek; mağaza içeriği bu pakette değiştirilmedi.

İlgili öğrenci/kurs toplulukları için gerçek kullanım örnekleri hazırlanabilir. Örneğin 20 saatlik içerik 1.5x hızda yaklaşık 13 saat 20 dakika sürer; günde 45 dakika ile 18 çalışma oturumu gerekir. Dış topluluklara gönderim, e-posta veya mağaza yayını bu planın hazırlanmasıyla yapılmış sayılmaz.

## 5. Uygulama ve kontrol sırası

1. İlk SEO metaverisi PR'ını incele; main'e birleştirme ve yayın ayrı yetkiyle yapılacak.
2. Search Console/Analytics başlangıç verisini kaydet ve en fazla üç öncelik seç.
3. Ölçüm paketini hazırla; ardından yalnızca verinin desteklediği içerik veya kullanım düzeltmesini uygula.
4. Her yayının tarihini/commit'ini kaydet; indekslenme, mobil hatalar ve başarılı hesaplamaları kontrol et.
5. Yaklaşık 4–6 haftalık gözlemden sonra trafiği ve kullanım başarısını birlikte değerlendir. Trafik yetersizse süreyi uzat; küçük farkları kesin sonuç sayma.
6. Ek dil ancak talep, çeviri kontrolü ve ayrı URL testleri hazırsa tek dille denenecek.

## İlk paketin doğrulama sınırı

Hesaplama JavaScript'i, CSS, gövde HTML'i, backend ve eklenti dosyaları değişmedi. Yerel yapısal kontrol ve mevcut testler uygulanacak; gerçek telefon, paylaşım platformu önizlemesi ve Google'ın sonuçta seçeceği başlık/site adı bu kontrollerin kapsamına girmez.

## Kaynaklar

- [Google: Sayfa başlıkları](https://developers.google.com/search/docs/appearance/title-link)
- [Google: Açıklamalar ve snippet'ler](https://developers.google.com/search/docs/appearance/snippet)
- [Google: Site adı ve WebSite verisi](https://developers.google.com/search/docs/appearance/site-names)
- [Google: Canonical](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Search Console: Performans raporları](https://support.google.com/webmasters/answer/10268906)
- [Analytics: Tarayıcı/cihaz dili](https://support.google.com/analytics/answer/13785913)
