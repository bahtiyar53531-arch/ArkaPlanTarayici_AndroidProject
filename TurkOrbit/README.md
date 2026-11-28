# TÜRK ORBIT — turkorbit.com

PC, web tarayıcısı, Android ve iOS'ta **aynı hesapla** oynanan, sunucu otoriteli gerçek zamanlı uzay MMO oyunu ve platformu.

> **Durum (28.11.2026):** Aşama 1–13 tamamlandı: araştırma (kısmen, ağ kısıtı), mimari, veritabanı/altyapı, **kayıt/giriş**, **oyuncu profili**, **hangar/ekipman**, **harita/oyun motoru**, **gerçek zamanlı çok oyunculu dünya**, **NPC ve savaş**, **görev sistemi** (318 görev, 05:00 TSİ sıfırlama) **ekonomi** (madencilik, üretim, açık artırma, günlük ödül, paketler) ve **klan ve sosyal** (klan, rütbe, defterli hazine ve vergi, diplomasi, Redis'te grup, 6 sohbet kanalı, arkadaşlık, engelleme, gizlilik, bildirimler, şikâyet) ve **forum ve destek** (oyun hesabıyla ortak forum, moderasyon, Türkçe arama; numaralı destek talepleri, içerikten doğrulanan ek dosyalar, destek masası). Yönetim Merkezi Aşama 14. Raporlar: [Aşama 1–4](Documentation/DevelopmentNotes/Asama-01-Raporu.md) · [Aşama 5](Documentation/DevelopmentNotes/Asama-05-Raporu.md) · [Aşama 6](Documentation/DevelopmentNotes/Asama-06-Raporu.md) · [Aşama 7](Documentation/DevelopmentNotes/Asama-07-Raporu.md) · [Aşama 8](Documentation/DevelopmentNotes/Asama-08-Raporu.md) · [Aşama 9](Documentation/DevelopmentNotes/Asama-09-Raporu.md) · [Aşama 10](Documentation/DevelopmentNotes/Asama-10-Raporu.md) · [Aşama 11](Documentation/DevelopmentNotes/Asama-11-Raporu.md) · [Aşama 12](Documentation/DevelopmentNotes/Asama-12-Raporu.md) · [Aşama 13](Documentation/DevelopmentNotes/Asama-13-Raporu.md).

## Hızlı başlangıç

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL 16 + Redis 7 + Mailpit (http://localhost:8025)
npm install
npm run db:migrate
npm run dev:api               # http://localhost:4000/api/v1
npm run dev:game              # ws://localhost:4001/game (gerçek zamanlı oyun sunucusu, Redis gerekir)
npm run dev:client            # http://localhost:5173
```

Ayrıntılı kurulum ve dosya yerleştirme: [Documentation/Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md](Documentation/Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm test` | Birim + entegrasyon testleri (gerçek PostgreSQL + Redis) |
| `npm run test:e2e` | API uçtan uca testi (gerçek API + oyun sunucusu + SMTP, iki hesap, çoklu platform) |
| `npm run test:ui` | Tarayıcı testi (Playwright; masaüstü + iPhone dikey/yatay görünümü, oyun ekranı dahil) |
| `npm run typecheck` | TypeScript denetimi |
| `npm run build` | Üretim derlemesi |
| `npm run admin:grant-role -- --user X --role super_admin --reason "..."` | Sunucu tarafı rol atama (denetim kaydına yazılır) |
| `npm run package:phase -- Asama-13-Forum-Destek` | Aşama ZIP teslimatı |

## Belgeler

[Documentation/README.md](Documentation/README.md): araştırma, teknik mimari, platform mimarisi, veritabanı, Yönetim Merkezi planı, aşamalar ve test planı, özgün dünya taslağı.
