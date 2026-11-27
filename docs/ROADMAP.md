> **27 Kasım 2026: Geliştirmeler kullanıcı talebiyle durduruldu.** Son çoklu dil güncellemeleri (#14–#16) geri alındı. Kullanıcı yeniden başlatmadan bu listedeki işlere devam edilmeyecek. Aşağıdaki liste tarihsel planı gösterir.

# Yol haritası

1. **Hesaplama doğruluğu ve web/eklenti tutarlılığı — tamamlandı.** Üst üste istek, özgün playlist konumları ve index davranışı PR #6/#7/#11 ile düzeltildi.
2. **Hata ve bekleme deneyimi — tamamlandı.** İptal, zaman aşımı, güvenli hata mesajları ve yeniden deneme PR #8/#11 ile eklendi.
3. **Otomatik testler ve bakım — tamamlandı.** PR #9/#11 ile frontend/backend CI ve test bağımlılığı bakımı tamamlandı.
4. **Depo güvenlik incelemesi — tamamlandı.** PR #10/#11 ile sayfalama döngüsü koruması eklendi. Harici hesap/anahtar ayarları depo incelemesinden ayrı kapsamdır.
5. **Çoklu dil desteği — mevcut paket.** Kullanıcının paylaştığı ülke dağılımına uygun sekiz dil, tarayıcı tercihiyle otomatik seçim, elle seçim ve tercih kaydı. Testlerden sonra web yayını yetkilendirildi. Ayrıntılar [durum kaydında](STATUS.md).
6. **Marka ve çok dilli SEO — sonraki ürün aşaması.** Dil başına indekslenebilir sayfalar, hreflang/sitemap, arama niyeti ve marka/içerik düzeni ayrıca planlanacak. Mevcut dil menüsü tek başına bu SEO altyapısının tamamlandığı anlamına gelmez.
7. **Diğer özellikler.** İzleme planı, video aralığı veya paylaşım gibi ek fikirler kullanıcıyla önceliklendirilecek; bu pakete eklenmedi.

Regresyon testleri ilgili değişiklikle birlikte eklenir. Güncel sonuçlar ve tarihçe [durum kaydında](STATUS.md) tutulur.
