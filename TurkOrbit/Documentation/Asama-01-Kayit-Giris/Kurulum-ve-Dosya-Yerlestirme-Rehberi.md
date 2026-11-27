# Aşama 1 — Kurulum ve Dosya Yerleştirme Rehberi

Bu rehber, teslimat ZIP'ini (`Deliveries/TurkOrbit-Asama-01-Kayit-Giris.zip`) kendi bilgisayarına veya Linux sunucuna kurman için adım adım yazıldı.

## 1. Gereksinimler

| Yazılım | Sürüm | Not |
|---|---|---|
| Node.js | 22 LTS veya üstü | `node -v` |
| PostgreSQL | 16 | Docker ile de kurulabilir |
| Redis | 7 | Docker ile de kurulabilir (geliştirmede isteğe bağlı, üretimde zorunlu) |
| Docker Desktop | isteğe bağlı | PostgreSQL + Redis + Mailpit'i tek komutla açmak için |

## 2. Dosyaları yerleştirme

ZIP'i açtığında tek bir `TurkOrbit/` klasörü çıkar. Bu klasörü istediğin yere koyabilirsin (ör. `C:\Projeler\TurkOrbit` veya `/opt/turkorbit`). Klasörün içindekiler:

| Klasör / dosya | Ne işe yarar | Değiştirmen gerekir mi? |
|---|---|---|
| `apps/api/` | REST API sunucusu | Hayır |
| `apps/client/` | Web oyun istemcisi (hesap ekranları) | Hayır |
| `packages/shared/` | Ortak kod | Hayır |
| `database/migrations/` | Veritabanı kurulum dosyaları | **Asla düzenleme**; yeni değişiklik = yeni numaralı dosya |
| `database/schema-draft.sql` | Gelecek aşamaların taslak şeması | Hayır (sadece okuma amaçlı) |
| `.env.example` | Örnek ayarlar | **`.env` adıyla kopyala ve düzenle** |
| `docker-compose.yml` | Yerel PostgreSQL/Redis/Mailpit | Hayır |
| `infra/nginx/turkorbit.conf.example` | Üretim sunucusu nginx örneği | Sunucuya kurarken alan adını kontrol et |
| `scripts/` | Test ve paketleme betikleri | Hayır |
| `Documentation/` | Belgeler | — |

> `node_modules/` ve `dist/` klasörleri ZIP'te **yoktur**; aşağıdaki komutlar bunları oluşturur.

## 3. Yerel geliştirme kurulumu (Windows / Mac / Linux)

```bash
cd TurkOrbit

# 1) Ayar dosyası
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env

# 2) Veritabanı + Redis + e-posta kutusu (Docker ile)
docker compose up -d
#   PostgreSQL: 127.0.0.1:5432  (kullanıcı turkorbit / parola turkorbit_dev / veritabanı turkorbit)
#   Redis:      127.0.0.1:6379
#   Mailpit:    http://localhost:8025  (gönderilen e-postaları buradan görürsün)

# 3) Bağımlılıklar
npm install

# 4) Veritabanı tablolarını oluştur
npm run db:migrate
```

**E-postaları görmek için** `.env` içinde şu iki satırı ayarla (Mailpit):
```
MAIL_TRANSPORT=smtp
SMTP_URL=smtp://127.0.0.1:1025
```
Ya da `MAIL_TRANSPORT=console` bırakırsan doğrulama/sıfırlama bağlantıları API'nin terminal çıktısına yazılır.

### Docker kullanmıyorsan
PostgreSQL 16 ve Redis'i kendin kur, sonra:
```sql
-- psql -U postgres
CREATE ROLE turkorbit LOGIN PASSWORD 'turkorbit_dev';
CREATE DATABASE turkorbit OWNER turkorbit;
CREATE DATABASE turkorbit_test OWNER turkorbit;   -- otomatik testler için
CREATE DATABASE turkorbit_e2e OWNER turkorbit;    -- uçtan uca testler için
```
`citext` uzantısı PostgreSQL 13+ sürümlerde veritabanı sahibi tarafından kurulabilir (migration bunu kendisi yapar).

## 4. Çalıştırma

İki ayrı terminal aç:

```bash
# Terminal 1 — API (http://localhost:4000/api/v1)
npm run dev:api

# Terminal 2 — Web istemcisi (http://localhost:5173)
npm run dev:client
```

Tarayıcıda **http://localhost:5173** adresini aç → **Kayıt ol** → e-postadaki bağlantıyı aç (Mailpit veya terminal) → **Giriş yap** → **Hesabım / Güvenlik**.

Aynı ağdaki telefondan denemek için: `http://<bilgisayarın-IP-adresi>:5173`. Bu durumda `.env` içinde `PUBLIC_WEB_URL` ve `ALLOWED_ORIGINS` değerlerine bu adresi ekle.

## 5. İlk yöneticiyi atama (sunucu tarafı)

Yöneticilik API'den veya arayüzden **verilemez**. Sunucuda, veritabanı erişimi olan kişi şu komutu çalıştırır:

```bash
npm run admin:grant-role -- --user <kullanıcı-adı|e-posta|oyuncu-ID> --role super_admin --reason "İlk kurulum"
npm run admin:revoke-role -- --user <...> --role moderator --reason "Görev değişikliği"
```

Geçerli roller: `read_only, support_staff, content_manager, moderator, community_admin, game_admin, system_admin, super_admin`. Her işlem `admin_audit_log` tablosuna yazılır.

## 6. Testleri çalıştırma

```bash
npm test               # birim + entegrasyon (turkorbit_test veritabanı ve Redis db 15 kullanılır)
npm run test:e2e       # gerçek API süreci + gerçek SMTP ile 18 adımlı uçtan uca test (turkorbit_e2e)
npm run test:ui        # tarayıcı testi (Playwright gerekir: npm i -D playwright && npx playwright install chromium)
npm run typecheck      # TypeScript denetimi
```

Test veritabanı adresi farklıysa: `TEST_DATABASE_URL=postgres://... TEST_REDIS_URL=redis://.../15 npm test`

> ⚠️ Testler `turkorbit_test` ve `turkorbit_e2e` veritabanlarındaki **tüm tabloları siler**. Bu adresleri asla gerçek oyun veritabanına yönlendirme.

## 7. Üretim kurulumu (Linux VPS/VDS — özet)

```bash
# Sunucuda (Ubuntu 24.04)
sudo apt install -y nginx postgresql-16 redis-server
# Node.js 22: https://nodejs.org (veya nvm)
cd /opt/turkorbit && npm ci && npm run build
cp .env.example .env   # NODE_ENV=production, REDIS_URL, CSRF_SECRET (openssl rand -base64 48),
                       # ALLOWED_ORIGINS=https://turkorbit.com, PUBLIC_WEB_URL=https://turkorbit.com,
                       # SMTP_URL=..., TRUST_PROXY=127.0.0.1, COOKIE_SECURE=true
npm run db:migrate
npm run start -w @turkorbit/api            # (PM2 veya systemd ile kalıcı çalıştır)
sudo cp -r apps/client/dist /var/www/turkorbit/client
sudo cp infra/nginx/turkorbit.conf.example /etc/nginx/sites-available/turkorbit.conf
sudo certbot --nginx -d turkorbit.com -d www.turkorbit.com
```

Üretimde API eksik veya güvensiz ayarlarla **başlamaz**: `REDIS_URL`, `CSRF_SECRET`, `ALLOWED_ORIGINS` ve `SMTP_URL` zorunludur. Ayrıntılı üretim kılavuzu Aşama 17'de hazırlanacak.

## 8. Mobil uygulama

Android APK/AAB ve iOS Xcode projesi **Aşama 15'te** üretilecek. Bu aşamada istemci, mobil tarayıcıda ve PWA olarak çalışır. API, uygulamalar için gereken `transport: "token"` oturum türünü şimdiden destekliyor ve test edildi.
