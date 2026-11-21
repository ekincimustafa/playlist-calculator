# Playlist Calculator proje talimatları

## Proje yapısı

- `index.html`, `style.css` ve `script.js`, GitHub Pages üzerinde çalışan web uygulamasını oluşturur. Mevcut tasarımı, kullanıcı arayüzü metinlerini ve özellikleri görev kapsamına göre koru.
- `extension/`, Manifest V3 Chrome eklentisidir. Web ve eklenti aynı FastAPI servisini kullanır. Her iki istemciyi etkileyen davranış ve API sözleşmesi değişikliklerinde iki akışı da doğrula.
- `backend/`, Render üzerinde çalışır ve YouTube Data API v3 çağrılarını sunucudan yapar. `YOUTUBE_API_KEY` yalnızca sunucu ortamında tutulur. Kurulum, CORS, önbellek ve kaynak sınırları için [backend README](backend/README.md) talimatlarını izle.

## Çalışma biçimi

- Güncel `main` üzerinden ayrı bir dal aç. Değişiklikleri görev kapsamında tut, ilgili testleri çalıştır ve incelemeye hazır PR aç. `main`e birleştirme ve canlı yayın için görevde açık yetki bulunmalı.
- Kabul edilen kapsamdaki rutin kodlama, test ve hata gidermeyi tamamla. Ürün kararı, önemli kapsam değişikliği, ücretli hizmet veya eksik hesap erişimi gerektiğinde proje sahibini dahil et.
- İş sırası için [yol haritasını](docs/ROADMAP.md), doğrulanmış bulgular ve test sonuçları için [durum kaydını](docs/STATUS.md) kullan. İlgili görev tamamlandığında durum kaydını güncelle.

## Testler

Komutları depo kökünden çalıştır. Backend test bağımlılıkları için `python -m pip install -r backend/requirements-dev.txt` komutunu kullan.

```sh
node --test tests/frontend-security.test.cjs
python -m unittest discover -s backend/tests -v
```

Testlerde gerçek YouTube kotası kullanma. Frontend isteklerini test taklitleriyle karşıla. Backend testlerinde sahte anahtar ve taklit YouTube yanıtları kullan. Yerel web sayfası varsayılan olarak canlı Render servisine istek gönderdiği için tarayıcı testlerinde de API isteklerini taklit et.
