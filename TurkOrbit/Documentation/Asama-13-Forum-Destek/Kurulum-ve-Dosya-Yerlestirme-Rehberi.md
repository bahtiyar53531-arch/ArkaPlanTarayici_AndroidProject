# Aşama 13 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-13-Forum-Destek.zip`) **Aşama 1–12'yi de içeren tam projedir**. İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak. Bu rehber, Aşama 12 kurulu bir sistemi günceller.

> **Önemli:**
> - **Yeni migration:** `0009_forum_support.sql`. Forum ve destek tablolarını, talep numarası dizisini, 6 forum bölümünü, "Topluluk Kuralları" konusunu ve `forum`, `support` ayarlarını ekler. Başlatmadan önce `npm run db:migrate` çalıştır.
> - **Yeni ortam değişkeni:** `UPLOAD_DIR`.
>   - Destek eklerinin saklandığı klasördür. **Web kökünün dışında** olmalı.
>   - API süreci yazabilmeli; nginx bu klasörü sunmamalı.
>   - Boş bırakılırsa API'nin çalıştığı klasörde `var/uploads` kullanılır.
>   - Yedekleme planına ekle (dosyalar veritabanında değil).
> - Yeni bağımlılık **yok**. Ekler ham gövdeyle yüklenir; nginx'te `client_max_body_size` en az **11m** olmalı.

## 1. Dosyaları yerleştirme
1. API'yi, oyun sunucusunu ve istemciyi durdur.
2. `.env` dosyanı ve veritabanını yedekle: `pg_dump -Fc turkorbit > turkorbit-asama12.dump`.
3. ZIP'i aç ve `TurkOrbit/` üzerine kopyala.
4. `.env` dosyana ekle: `UPLOAD_DIR=/var/lib/turkorbit/uploads`. Klasörü oluştur: `install -d -m 700 -o turkorbit /var/lib/turkorbit/uploads`.
5. `npm install` ve `npm run db:migrate` çalıştır. Çıktıda `✔ uygulandı: 0009_forum_support.sql` görünmelidir.

| Yeni / değişen dosya | Ne |
|---|---|
| `database/migrations/0009_forum_support.sql` | **Yeni:** 9 tablo (forum ×6, destek ×3), `support_ticket_seq`, bölümler, kurallar konusu, ayarlar |
| `packages/shared/src/community.ts` | **Yeni:** şemalar, talep numarası, dosya türü tespiti (sihirli baytlar), dosya adı temizliği, API tipleri |
| `apps/api/src/modules/forum/` | **Yeni:** forum servisi ve uçları |
| `apps/api/src/modules/support/` | **Yeni:** destek servisi, uçları ve yanıt e-postası |
| `apps/api/src/lib/storage.ts` | **Yeni:** dosya deposu (yerel disk sürücüsü) |
| `apps/api/src/{app.ts, config/env.ts}` | Servis bağlantıları, `UPLOAD_DIR` |
| `apps/client/src/pages/{ForumPages,SupportPages}.tsx` | **Yeni:** forum ve destek sayfaları, destek masası |
| `apps/client/src/{App.tsx, components/Layout.tsx, api/client.ts, components/social/ReportDialog.tsx, styles/global.css}` | Yollar, menü, dosya yükleme, forum şikâyeti, stiller |

## 2. nginx
```nginx
# Destek ekleri (uygulama 10 MB'den büyük gövdeyi zaten reddeder)
location /api/v1/support/ {
    client_max_body_size 11m;
    proxy_pass http://turkorbit_api;
}
```
`UPLOAD_DIR` klasörü için hiçbir `location` tanımlama. Dosyalar yalnızca API'nin yetki denetimli ucundan indirilir.

## 3. Personel rolleri (sunucu tarafı)
- Destek personeli: `npx tsx apps/api/src/scripts/role-cli.ts grant --user <ad> --role support_staff --reason "..."`.
- Forum moderatörü: `--role moderator`.
- Bölüm moderatörü: `forum.moderators.assign` yetkili bir hesap (ör. topluluk yöneticisi) `POST /api/v1/forum/moderators {category, username, assign}` ile atar.

## 4. Geliştirme ortamında deneme
1. **Forum:** Oturumsuz açıp bölümleri ve kuralları gör. Giriş yapıp **Rehberler** bölümünde konu aç. İkinci hesapla yanıtla, alıntıla, beğen. "gemi" diye ara.
2. **Kilit:** Bir hesaba moderatör rolü ver, konuyu kilitle. Diğer hesapta yanıt kutusu yerine "Bu konu kilitli" yazar.
3. **Destek:** **Destek** sayfasında talep aç ve PNG ekle. Uzantısını `.png` yaptığın bir `.exe` reddedilir.
4. **Destek masası:** Bir hesaba `support_staff` ver. **Destek** sayfasındaki "Destek masası" bağlantısından talebi aç, iç not ve yanıt yaz. Oyuncu hesabında ekip yanıtı görünür, iç not görünmez.

## 5. Değerleri değiştirme (Yönetim Merkezi gelene kadar, SQL ile)
| Ne | Nerede |
|---|---|
| Sayfa başına konu/mesaj, düzenleme süresi | `game_settings.forum` |
| Ek boyutu, sayısı, ekleme süresi, açık talep sınırı, kendiliğinden kapanma | `game_settings.support` |
| Bölümler (ad, açıklama, sıra, konu açma yetkisi, arşiv) | `forum_categories` |
| Şikâyet kuyruğu | `SELECT * FROM reports WHERE status = 'open'` |

## 6. Testler
```bash
npm test            # ortak (dosya türü, ad temizliği, şemalar) + API (forum, kilit, moderasyon, arama, 50 eşzamanlı talep, ekler, durum akışı)
npm run test:e2e    # API uçtan uca: forum, destek + ek, moderatör kilidi, personel yanıtı ve gerçek SMTP e-postası
npm run test:ui     # tarayıcı: oturumsuz forum, konu/yanıt/alıntı/beğeni, kilit, arama, destek talebi + ek, destek masası, telefon
```
