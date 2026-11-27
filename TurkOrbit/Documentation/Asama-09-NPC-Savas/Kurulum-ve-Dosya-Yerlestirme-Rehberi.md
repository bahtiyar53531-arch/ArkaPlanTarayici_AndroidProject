# Aşama 9 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-09-NPC-Savas.zip`) **Aşama 1–8'i de içeren tam projedir**. İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md), oyun sunucusu (systemd, nginx) için [Aşama 8 rehberine](../Asama-08-Multiplayer/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak. Bu rehber, Aşama 8 kurulu bir sistemi günceller.

> **Önemli değişiklikler:**
> - **Yeni migration:** `0005_combat.sql`. API veya oyun sunucusunu başlatmadan önce `npm run db:migrate` çalıştır.
> - **Protokol sürümü 2:** Oyun sunucusu ve web istemcisi **birlikte** güncellenmelidir. Eski istemci (v1) bağlanırsa 4010 koduyla kapatılır ve "Oyun güncellendi. Devam etmek için sayfayı yenile." mesajı görünür; sayfa yenilenince yeni istemci yüklenir.

## 1. Dosyaları yerleştirme
1. API'yi, oyun sunucusunu ve istemciyi durdur.
2. `TurkOrbit/.env` dosyanı yedekle (ZIP'te `.env` yoktur).
3. Veritabanını yedekle: `pg_dump -Fc turkorbit > turkorbit-asama8.dump`.
4. ZIP'i aç ve `TurkOrbit/` klasörünün üzerine kopyala.
5. `npm install` ve ardından `npm run db:migrate` çalıştır. Çıktıda `✔ uygulandı: 0005_combat.sql` görünmelidir.

| Yeni / değişen dosya | Ne |
|---|---|
| `database/migrations/0005_combat.sql` | **Yeni:** NPC türleri, ödül tabloları ve satırları, doğma alanları, ölüm ve öldürme kayıtları, `game_settings.combat`. İçerik: 11 NPC türü, 52 ödül satırı, 21 haritada 111 doğma alanı |
| `packages/shared/src/combat.ts` | **Yeni:** sunucu ve istemcinin ortak savaş kuralları: hasar/kalkan hesabı, saldırı izni (güvenli bölge, PvP), ödül zarı, mühimmat/roket kodları |
| `packages/shared/src/net.ts` | Protokol v2: hedef/ateş/mühimmat/roket/yeniden doğma mesajları, can ve kalkan içeren anlık görüntü, efekt (`fx`), `cs`, `reward`, `dead` |
| `packages/shared/src/world.ts` | Yeni tuşlar: ateş (Boşluk), roket (R), sonraki hedef (Tab) |
| `apps/api/src/game/server.ts` | Oyun sunucusu: NPC yapay zekâsı, lazer/roket, hasar, ölüm, yeniden doğma, ödül, kargo kutusu, PvP |
| `apps/api/src/game/content.ts` | **Yeni:** NPC türleri, ödül tabloları, mühimmat/roket değerleri ve savaş ayarlarını veritabanından okur |
| `apps/api/src/game/persistence.ts` | **Yeni:** ödül, kargo, ölüm, mühimmat harcaması: transaction içinde ve idempotency anahtarıyla (çift ödül olmaz) |
| `apps/api/src/modules/world/service.ts` | Şirket istasyonunda yeniden doğma; ölü gemiyle bağlanan pilotun otomatik yeniden doğması |
| `apps/api/src/modules/hangar/service.ts` | Tamir canlı olarak oyuna yansır. Mağazadan alınan mühimmat oyundaki sayıya anında eklenir |
| `apps/client/src/game/{controller,SpaceScene,textures}.ts` | Hedef seçme, ateş, efektler (lazer, roket, hasar sayısı, patlama), NPC ve kargo kutusu görselleri |
| `apps/client/src/components/game/GameHud.tsx` | Hedef paneli, mühimmat çubuğu, can/kalkan çubukları, dokunmatik savaş butonları, ölüm ekranı |
| `apps/client/src/pages/GamePage.tsx`, `styles/game.css`, `components/game/SettingsPanel.tsx` | Savaş tuşları, HUD yerleşimi, tuş ataması ekranında yeni tuşlar |
| `database/schema-draft.sql` | NPC ve ödül tabloları taslaktan çıkarıldı (artık 0005'te) |

Yeni ortam değişkeni ve yeni bağımlılık **yok**.

## 2. Geliştirme ortamında çalıştırma
```bash
cd TurkOrbit
npm install
npm run db:migrate
npm run dev:api      # http://localhost:4000/api/v1
npm run dev:game     # ws://localhost:4001/game
npm run dev:client   # http://localhost:5173
```
Deneme:
1. Giriş yap ve **Oyna**'ya tıkla. Şirket haritasında (x-1) istasyondan uzaklaş; Çakallar görünür.
2. Bir Çakala tıkla (veya **Tab**). Üstte hedef paneli açılır. **Boşluk** ile ateş et; lazer çizgisi ve hasar sayıları görünür.
3. Çakal ölünce sağ altta ödül bildirimi (Kredi + deneyim) çıkar. Kargo kutusu düşerse üzerine uç; kutu toplanır.
4. Mühimmatı **1–5** ile değiştir. **R** roket atar (bekleme süresi var).
5. x-2 haritasında Sürü Başı veya Akrep saldırgandır. Ölürsen "İstasyonda yeniden doğ" ekranı gelir; şirket istasyonunda %10 canla doğarsın. Tam onarım: **Hangar → Tamir** (istasyondayken).

Telefonda: hedefe dokun; joystick'in karşı tarafında **Ateş**, **Roket** ve 🎯 (en yakın hedef) butonları vardır.

## 3. Üretim
Aşama 8 ile aynı iki süreç (API ve oyun sunucusu). Güncelleme sırası:
```bash
npm ci && npm run build
npm run db:migrate                      # önce migration
systemctl restart turkorbit-api turkorbit-game
```
Oyun sunucusu kapanırken (SIGTERM) bekleyen ödül, ölüm ve mühimmat kayıtlarını yazıp öyle çıkar (`TimeoutStopSec=15` yeterli).

## 4. Değerleri değiştirme (Yönetim Merkezi gelene kadar, SQL ile)
- **NPC değerleri:** `UPDATE npc_types SET hitpoints = 500 WHERE code = 'cakal';` Oyun sunucusu yeniden başlatılınca yansır.
- **Ödüller:** `reward_entries` (`min_amount`, `max_amount`, `chance`, `delivery = 'direct' | 'cargo'`). Oyun sunucusu yeniden başlatılınca yansır.
- **Doğma alanları:** `npc_spawns` (`max_alive`, `respawn_seconds`, `is_enabled`). Harita odası bir sonraki açılışta okur (haritada pilot kalmayınca oda kapanır); en kesin yol yeniden başlatmaktır.
- **Savaş kuralları:** `game_settings` → `combat` anahtarı (yeniden doğma canı, kargo sahiplik süresi, PvP şerefi, hasar sapması). Oyun sunucusu yeniden başlatılınca yansır.
- **PvP haritaları / güvenli bölgeler:** `maps.pvp_enabled`, `map_zones` (`safe` ve `station` türleri güvenli bölgedir; Aşama 7). Harita odası açılırken okunur.

> Canlı içerik güncellemesi (yeniden başlatmadan) Aşama 14'te Yönetim Merkezi ile gelecek.

## 5. Testler
```bash
npm test            # paylaşılan + API entegrasyon (savaş: gerçek WebSocket + PostgreSQL + Redis)
npm run test:e2e    # API uçtan uca: gerçek API + oyun sunucusu süreçleri; NPC öldürme ve ödül adımı dahil
npm run test:ui     # tarayıcı: hedef seçme, ateş, ödül, kargo, ölüm ve yeniden doğma (Playwright gerekir)
```
Testler kendi deneme NPC'lerini ekler ve gerçek doğma alanlarını test süresince kapatır. Test veritabanları geliştirme veritabanından ayrıdır.
