# Aşama 8 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-08-Multiplayer.zip`) **Aşama 1–7'yi de içeren tam projedir**. İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak. Bu rehber, Aşama 7 kurulu bir sistemi günceller.

> **Önemli değişiklik:** Oyun artık **iki süreçle** çalışır: REST API (4000) ve gerçek zamanlı **oyun sunucusu** (4001). Oyun sunucusu çalışmıyorsa oyun ekranı "Bağlanılıyor…" der ve bekler. Oyun sunucusu için **Redis zorunludur**.

## 1. Dosyaları yerleştirme
1. API'yi, istemciyi ve (varsa) oyun sunucusunu durdur.
2. `TurkOrbit/.env` dosyanı yedekle (ZIP'te `.env` yoktur).
3. ZIP'i aç ve `TurkOrbit/` klasörünün üzerine kopyala.
4. Eski `apps/game-server/` klasörü (yalnızca README içeriyordu) varsa silebilirsin. Oyun sunucusu artık `apps/api/src/game/` altında.

| Yeni / değişen dosya | Ne |
|---|---|
| `packages/shared/src/net.ts` | Ağ protokolü (mesaj şemaları, kapanış kodları) ve **sunucu ile istemcinin ortak** hareket simülasyonu |
| `apps/api/src/game/` | **Oyun sunucusu** (ayrı süreç): `server.ts` (WebSocket, 20 Hz simülasyon, AOI, geçit, kalıcılık), `index.ts` (süreç girişi), `logger.ts` |
| `apps/api/src/modules/game/` | Oyun bileti uç noktası ve Redis köprüsü (çevrimiçi durum, tek oturum, canlı değişiklik) |
| `apps/api/src/modules/hangar/service.ts` | "Oyundayken yalnızca istasyonda ekipman" kuralı + değişiklikleri oyun sunucusuna bildirme |
| `apps/api/src/modules/world/` | REST konum/geçit uç noktaları kaldırıldı; oyun sunucusunun kullandığı geçit ve dünyaya giriş servisleri |
| `apps/client/src/game/controller.ts` | WebSocket istemcisi: tahmin, uzlaştırma, enterpolasyon, yeniden bağlanma |
| `apps/client/src/game/SpaceScene.ts` | Diğer pilotların gemileri ve ad etiketleri |
| `apps/client/src/components/game/GameHud.tsx` | Radar listesi, mini haritada pilotlar, bağlantı durumu, ping, "başka cihaz" ekranı |
| `apps/client/vite.config.ts` | `/game` WebSocket yönlendirmesi (geliştirme) |
| `infra/nginx/turkorbit.conf.example` | `/game` WebSocket yönlendirmesi (üretim) |
| `apps/api/package.json` | **Yeni bağımlılık:** `ws@8` · yeni komutlar `dev:game`, `start:game` |
| `.env.example` | `GAME_PORT`, `GAME_LINGER_SECONDS` |

Veritabanı değişikliği **yok** (yeni migration yok).

## 2. Ortam değişkenleri (`.env`)
```ini
REDIS_URL=redis://127.0.0.1:6379     # oyun sunucusu için zorunlu
GAME_PORT=4001                       # oyun sunucusunun portu
GAME_LINGER_SECONDS=30               # bağlantısı kopan geminin haritada kalma süresi (0 = hemen kaldır)
ALLOWED_ORIGINS=https://turkorbit.com,capacitor://localhost   # WebSocket Origin denetimi de bu listeyi kullanır
```

## 3. Geliştirme ortamında çalıştırma (üç terminal)
```bash
cd TurkOrbit
npm install
npm run dev:api      # http://localhost:4000/api/v1
npm run dev:game     # ws://localhost:4001/game  (Redis gerekir)
npm run dev:client   # http://localhost:5173  (/api ve /game yönlendirilir)
```
Deneme:
1. İki farklı tarayıcıda (veya biri gizli pencere) iki hesapla giriş yap ve **Oyna**'ya tıkla.
2. İki pilotu aynı haritaya getir (aynı şirket ya da geçitlerle). Radar menzilinde (1500 birim) birbirinizi gemi, ad etiketi ve sağ üstteki **Radar** listesinde görürsün.
3. Aynı hesapla telefondan da oyuna gir. PC'de "Başka bir cihazda oyundasın" ekranı çıkar; **Bu cihazda devam et** ile geri alınır.
4. Oyun sunucusunu durdurup yeniden başlat. İstemci "Bağlantı koptu, yeniden bağlanılıyor…" gösterir ve kendiliğinden bağlanır.

## 4. Üretim (Linux VPS)
```bash
npm ci && npm run build
# systemd veya PM2 ile iki süreç:
node --env-file=.env apps/api/dist/index.js        # API (4000)
node --env-file=.env apps/api/dist/game/index.js   # Oyun sunucusu (4001)
```
Örnek systemd birimi (`/etc/systemd/system/turkorbit-game.service`):
```ini
[Unit]
Description=Türk Orbit oyun sunucusu
After=network.target redis-server.service postgresql.service

[Service]
WorkingDirectory=/opt/turkorbit
ExecStart=/usr/bin/node --env-file=/opt/turkorbit/.env apps/api/dist/game/index.js
Restart=always
RestartSec=2
User=turkorbit
# Kapanışta oyunculara 4004 gönderilir, konumlar kaydedilir
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```
nginx: `infra/nginx/turkorbit.conf.example` içindeki `location = /game` bloğunu ekle (WebSocket `Upgrade` başlıkları ve 120 sn zaman aşımı). CSP'deki `connect-src` alanında `wss://turkorbit.com` bulunmalıdır.

> Gemi dokuları tarayıcıda `blob:` adresinden yüklenir. Bu yüzden örnek CSP'de `img-src` alanına `blob:` eklendi.

## 5. Değerleri değiştirme (Yönetim Merkezi gelene kadar)
- Kopma sonrası haritada kalma süresi: `.env` → `GAME_LINGER_SECONDS` (oyun sunucusunu yeniden başlat).
- Harita bakımı: `UPDATE maps SET is_closed = true WHERE code = 'K-5';` İçerideki çevrimiçi pilotlar en geç 15 sn içinde şirket haritasına taşınır.
- Gemi hızı/radar: hangarda yapılan değişiklikler oyuna anında yansır. `item_types.stats` SQL ile değiştirilirse oyuncu yeniden bağlanınca veya hangarda bir işlem yapınca yansır.

## 6. Testler
```bash
npm test            # paylaşılan + API entegrasyon (oyun sunucusu gerçek WebSocket + PostgreSQL + Redis ile)
npm run test:e2e    # API uçtan uca: API + oyun sunucusu süreçleri, iki hesap
npm run test:ui     # tarayıcı: iki pilot birbirini görür, sunucu yeniden başlatma, tek oturum (Playwright gerekir)
```
