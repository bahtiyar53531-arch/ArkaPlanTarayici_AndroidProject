# Aşama 11 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-11-Ekonomi.zip`) **Aşama 1–10'u da içeren tam projedir**. İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md), oyun sunucusu için [Aşama 8 rehberine](../Asama-08-Multiplayer/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak. Bu rehber, Aşama 10 kurulu bir sistemi günceller.

> **Önemli:**
> - **Yeni migration:** `0007_economy.sql`. Kaynaklar, maden noktaları, tarifler, açık artırma, günlük ödül, paketler ve 18 görev ekler. Başlatmadan önce `npm run db:migrate` çalıştır.
> - **API süreci artık bir zamanlayıcı çalıştırır:** açık artırma dönemlerini oluşturur, süresi dolanları sonuçlandırır (10 sn'de bir). Birden çok API süreci çalışsa da güvenlidir.
> - Protokol sürümü değişmedi (2). Yeni varlık türü `r` (maden noktası) ve `cs.cargo` alanı eklendi; oyun sunucusunu ve istemciyi **birlikte** güncelle.

## 1. Dosyaları yerleştirme
1. API'yi, oyun sunucusunu ve istemciyi durdur.
2. `.env` dosyanı ve veritabanını yedekle: `pg_dump -Fc turkorbit > turkorbit-asama10.dump`.
3. ZIP'i aç ve `TurkOrbit/` üzerine kopyala.
4. `npm install` ve `npm run db:migrate` çalıştır. Çıktıda `✔ uygulandı: 0007_economy.sql` görünmelidir.

| Yeni / değişen dosya | Ne |
|---|---|
| `database/migrations/0007_economy.sql` | **Yeni:** 7 kaynak eşyası, `resource_nodes` (45 grup), `crafting_recipes` (12) + `player_crafting_jobs`, `auction_lots` (9) + `auctions` + `auction_bids`, `daily_login_rewards` + `player_daily_logins`, paket teklifleri (3), 18 madencilik/üretim görevi, ayarlar |
| `packages/shared/src/economy.ts` | **Yeni:** açık artırma dönemi ve teklif kuralları, günlük seri, istek şemaları, API tipleri |
| `packages/shared/src/{items,quests,combat,net,api-types,player}.ts` | `resource` kategorisi, `collect_resource`/`craft_item` hedefleri, `cs.cargo`, varlık türü `r`, paket alanları, hata kodları ve defter etiketleri |
| `apps/api/src/modules/market/` | **Yeni:** Pazar servisi (üretim, günlük ödül, açık artırma + zamanlayıcı) ve uçları |
| `apps/api/src/modules/hangar/service.ts` | Mağaza paketleri (liste + satın alma) |
| `apps/api/src/game/{server,content,persistence}.ts` | Maden noktaları, toplama, ambar kapasitesi |
| `apps/api/src/index.ts` | Açık artırma zamanlayıcısını başlatır/durdurur |
| `apps/client/src/pages/MarketPages.tsx` | **Yeni:** `/pazar` (Günlük ödül · Kaynaklar · Üretim · Açık artırma) |
| `apps/client/src/{game/*, components/game/GameHud.tsx, components/ShipArt.tsx, pages/HangarPages.tsx, lib/format.ts, styles/*}` | Kristal görseli, mini haritada maden noktaları, ambar göstergesi, paket kartları, "Kaynaklar" envanter filtresi |

Yeni ortam değişkeni ve yeni bağımlılık **yok**.

## 2. Geliştirme ortamında deneme
1. **Pazar > Günlük ödül:** "1. gün ödülünü al".
2. **Madencilik:**
   - Oyunda şirket haritandaki kaynak bölgesine git; mini haritada bölge daireleri görünür. Örneğin K-1 Ferrolit kuşağı (16000, 9600), G-1 Titanyum bulutu (9500, 7500), A-1 Ferrolit kuşağı (5300, 10300).
   - Renkli kristallere tıklayınca gemi oraya gider ve kaynağı toplar. Sol üstte "Ambar x / y" görünür.
3. **Pazar > Kaynaklar:** Kaynakları sat.
4. **Pazar > Üretim:** Rafineride Nebulit veya Kristalyum, atölyede mühimmat ya da roket üret. Süre dolunca "Teslim al".
5. **Pazar > Açık artırma:** Teklif ver. Başka bir hesapla geçince ilk hesabın bakiyesine iade gelir.
6. **Mağaza > Paketler:** Acemi Pilot Paketi (%40 indirim, hesap başına bir kez).

## 3. Üretim
```bash
npm ci && npm run build
npm run db:migrate
systemctl restart turkorbit-api turkorbit-game
```
- Açık artırmalar API sürecinin zamanlayıcısıyla sonuçlanır. API kapalıyken süresi dolanlar, API açılınca (veya ilk liste isteğinde) sonuçlandırılır.
- Kazananın eşyası o anda verilir.

## 4. Değerleri değiştirme (Yönetim Merkezi gelene kadar, SQL ile)

| Ne | Nerede | Ne zaman yansır |
|---|---|---|
| Kaynak satış fiyatı | `item_types.sell_price` (`category = 'resource'`) | Hemen |
| Maden noktaları | `resource_nodes` (`max_count`, `respawn_seconds`, `yield_min/max`, `is_enabled`) | Harita odası bir sonraki açılışta okur (en kesini oyun sunucusunu yeniden başlatmak) |
| Toplama yarıçapı | `game_settings.mining.pickup_radius` | Oyun sunucusu yeniden başlatılınca |
| Tarifler | `crafting_recipes` (`inputs` JSON, süre, seviye, `is_active`) | Hemen; çalışan üretimler başlatıldığı haliyle tamamlanır |
| Üretim kuyruğu | `game_settings.crafting` (`slots`, `max_batches`) | Hemen |
| Açık artırma lotları | `auction_lots` (eşya, adet, taban fiyat, tür, `is_active`) | Bir sonraki dönemde |
| Teklif kuralları | `game_settings.auction` (artış yüzdesi, son saniye penceresi ve uzatma) | Hemen |
| Günlük ödül takvimi | `daily_login_rewards` → `reward_entries` (`daily.1` … `daily.7`) | Hemen |
| Paketler | `shop_offers` (`offer_type = 'bundle'`, `bundle_items`, indirim, sınır) | Hemen |

## 5. Testler
```bash
npm test            # ortak (dönemler, teklif kuralları, seri) + API (üretim, ödül, açık artırma, 50 eşzamanlı satın alma, paketler, madencilik)
npm run test:e2e    # API uçtan uca: günlük ödül, oyunda madencilik, satış, üretim, açık artırma, paket
npm run test:ui     # tarayıcı: madencilik HUD'u, Pazar sekmeleri, paket satın alma, telefonda Pazar
```
