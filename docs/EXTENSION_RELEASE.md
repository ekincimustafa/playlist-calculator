# Chrome eklentisi 1.1.0 yayın hazırlığı

Bu paket, `d58612f` main sürümündeki eklenti kodunu ve manifest sürüm artışını içerir. Chrome Web Store'a yüklenmedi veya incelemeye gönderilmedi.

## Değişiklikler

- Playlist sırası, tekrar eden girişler ve özgün video konumları korunur; `index` seçimi erişilemeyen videolardan etkilenmez.
- İstek iptali, yanıt gövdesi okumasını da kapsayan 150 saniyelik zaman aşımı, sayfa içi hata bildirimi ve yeniden deneme bulunur.
- Eski konumsuz playlist kayıtları yeniden hesaplama ile yenilenir; tek video kayıtları ve kayıtlı hız korunur.
- Manifest V3 ve `activeTab` / `storage` izinleri değişmedi. Yeni izin veya uzak JavaScript eklenmedi.

## Paket

ZIP kökünde `manifest.json`, `popup.html`, `popup.js`, `calculation-request.js`, `16x16.png`, `48x48.png` ve `128x128.png` bulunmalı. Kaynak `extension/` klasörü ZIP içinde fazladan üst klasör olmamalı. Kullanılmayan `icon.png`, backend, testler ve belgeler pakete dahil edilmez.

Depo kökünden yeniden paketlemek için:

```sh
python - <<'PY'
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path('extension')
version = json.loads((root / 'manifest.json').read_text())['version']
out = Path('dist')
out.mkdir(exist_ok=True)
names = ['manifest.json', 'popup.html', 'popup.js', 'calculation-request.js',
         '16x16.png', '48x48.png', '128x128.png']
with ZipFile(out / f'ytplaylistcalculator-extension-{version}.zip', 'w', ZIP_DEFLATED) as archive:
    for name in names:
        archive.write(root / name, name)
PY
```

## Yüklemeden önce

1. Geliştirici panelinde yeni bir ürün oluşturmak yerine mevcut `ecdjlbdgjnlmjhmdllgnfakocdcpaieg` öğesini aç. Mağazadaki son yayınlanmış/taslak sürümün `1.1.0` değerinden küçük olduğunu doğrula. Panel sürümü bu hazırlıkta doğrulanamadı; gerekirse manifest sürümünü daha yüksek bir değere çıkarıp ZIP'i yeniden oluştur.
2. `node --test tests/*.test.cjs` çalıştır. Dış API isteklerini taklit ederek popup başarı, özgün konum/index, iptal ve yeniden deneme akışlarını kontrol et. Yalnızca yerelde paket dışı yüklemek yayınlanmış eklenti kimliğini korumaz; üretim CORS listesini bu deneme için genişletme.
3. ZIP içindeki manifest sürümünü, referans verilen dosyaları ve izinleri kontrol et.
4. Package / Upload New Package ile ZIP'i yükle. Mağaza açıklaması, gizlilik beyanları ve ekran görüntülerinin yeni davranışla uyumunu gözden geçir.
5. İncelemeye gönderme ve yayın işlemlerini ayrı kullanıcı kararıyla yap. Bu hazırlık bu işlemleri gerçekleştirmez.

Resmî güncelleme rehberi: https://developer.chrome.com/docs/webstore/update
