# TÜRK ORBIT — turkorbit.com

PC, web tarayıcısı, Android ve iOS'ta **aynı hesapla** oynanan, sunucu otoriteli gerçek zamanlı uzay MMO oyunu ve platformu.

> **Durum (27.11.2026):** Aşama 1–4 tamamlandı: araştırma, mimari, veritabanı/altyapı ve **kayıt/giriş sistemi** (web). Araştırma, ağ kısıtı nedeniyle kısmen yapıldı. Ayrıntı: [Aşama 1 raporu](Documentation/DevelopmentNotes/Asama-01-Raporu.md).

## Hızlı başlangıç

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL 16 + Redis 7 + Mailpit (http://localhost:8025)
npm install
npm run db:migrate
npm run dev:api               # http://localhost:4000/api/v1
npm run dev:client            # http://localhost:5173
```

Ayrıntılı kurulum ve dosya yerleştirme: [Documentation/Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md](Documentation/Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm test` | Birim + entegrasyon testleri (gerçek PostgreSQL + Redis) |
| `npm run test:e2e` | API uçtan uca testi (gerçek sunucu + SMTP, iki hesap, çoklu platform) |
| `npm run test:ui` | Tarayıcı testi (Playwright; masaüstü + iPhone görünümü) |
| `npm run typecheck` | TypeScript denetimi |
| `npm run build` | Üretim derlemesi |
| `npm run admin:grant-role -- --user X --role super_admin --reason "..."` | Sunucu tarafı rol atama (denetim kaydına yazılır) |
| `npm run package:phase -- Asama-01-Kayit-Giris` | Aşama ZIP teslimatı |

## Belgeler

[Documentation/README.md](Documentation/README.md): araştırma, teknik mimari, platform mimarisi, veritabanı, Yönetim Merkezi planı, aşamalar ve test planı, özgün dünya taslağı.
