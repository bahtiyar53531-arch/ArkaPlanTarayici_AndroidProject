# Aşama 10 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-10-Gorev-Sistemi.zip`) **Aşama 1–9'u da içeren tam projedir**. İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md), oyun sunucusu (systemd, nginx) için [Aşama 8 rehberine](../Asama-08-Multiplayer/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak. Bu rehber, Aşama 9 kurulu bir sistemi günceller.

> **Önemli:**
> - **Yeni migration:** `0006_quests.sql` (görev tabloları + 300 görev). Başlatmadan önce `npm run db:migrate` çalıştır.
> - Protokol sürümü değişmedi (2). Yeni `qp` ve `quests` mesajları eski istemcide yok sayılır, ama görev izleyicisi için istemciyi de güncelle.
> - **Sunucu saati doğru olmalı (NTP).** Günlük/haftalık görevler sunucu saatine göre 05:00 TSİ'de yenilenir; etkinlikler tarih penceresine göre açılır.

## 1. Dosyaları yerleştirme
1. API'yi, oyun sunucusunu ve istemciyi durdur.
2. `TurkOrbit/.env` dosyanı yedekle (ZIP'te `.env` yoktur). Veritabanını yedekle: `pg_dump -Fc turkorbit > turkorbit-asama9.dump`.
3. ZIP'i aç ve `TurkOrbit/` klasörünün üzerine kopyala.
4. `npm install` ve `npm run db:migrate` çalıştır. Çıktıda `✔ uygulandı: 0006_quests.sql` görünmelidir.

| Yeni / değişen dosya | Ne |
|---|---|
| `database/migrations/0006_quests.sql` | **Yeni:** `quests`, `quest_objectives`, `player_quests`, `player_quest_cycles`, `game_settings.quests` ve 300 görev (120 ana/zincir, 90 günlük, 60 haftalık, 30 etkinlik) |
| `packages/shared/src/quests.ts` | **Yeni:** döngü anahtarı (05:00 TSİ), hedef eşleme, tohumlu seçim, API tipleri |
| `apps/api/src/modules/quest/` | **Yeni:** görev servisi ve uçları (`GET /quests`, `POST /quests/accept · abandon · reroll · claim`) |
| `apps/api/src/modules/economy/rewards.ts` | **Yeni:** ortak ödül verme (NPC, kargo ve görev ödülü aynı defter yolundan) |
| `apps/api/src/modules/player/achievements.ts` | **Yeni:** başarım değerlendirmesi (oyun olaylarında anında) |
| `apps/api/src/game/server.ts` | Görev olayları (öldürme, kargo, ziyaret, hasar, yol, roket, geçit, seviye), saniyede bir toplu yazım, `qp`/`quests` mesajları, anında başarım bildirimi |
| `apps/api/src/game/persistence.ts` | Ödül verme ortak modüle taşındı |
| `apps/api/src/modules/hangar/service.ts` | Başarılı yükseltme ve satın alma görevi aynı transaction'da ilerletir |
| `apps/api/src/modules/game/bridge.ts` | Yeni bildirim gerekçesi: `quests` |
| `apps/client/src/components/quests/QuestBoard.tsx` | **Yeni:** görev panosu (sayfa ve oyun içi çekmece ortak) |
| `apps/client/src/pages/QuestPages.tsx` | **Yeni:** `/gorevler` sayfası |
| `apps/client/src/game/controller.ts`, `components/game/GameHud.tsx`, `pages/GamePage.tsx` | Görev izleyici, Q ile görev çekmecesi, canlı ilerleme |
| `packages/shared/src/world.ts` | Yeni tuş: görevler (Q) |
| `database/schema-draft.sql` | Görev tabloları taslaktan çıkarıldı (artık 0006'da) |

Yeni ortam değişkeni ve yeni bağımlılık **yok**.

## 2. Geliştirme ortamında deneme
```bash
npm run db:migrate
npm run dev:api & npm run dev:game & npm run dev:client
```
1. Giriş yap → üst menüde **Görevler**. "Ana ve zincir" sekmesinde zincirlerin ilk görevleri, Günlük ve Haftalık sekmelerinde 3'er görev görünür.
2. **İlk Uçuş** görevini kabul et → **Oyna**. Sol üstte görev izleyici var. Uçtukça ilerleme artar; 3.000 birimde "Görev tamamlandı" bildirimi gelir.
3. **Q** tuşu ile görev çekmecesini aç → **Ödülü al**. Kredi ve deneyim eklenir, zincirin sonraki görevi açılır.
4. Hangarda mağazadan mühimmat al → "Mühimmat Deposu" görevi (zincirin 4. görevi) ilerler.

## 3. Üretim
Aşama 9 ile aynı iki süreç. Güncelleme sırası:
```bash
npm ci && npm run build
npm run db:migrate
systemctl restart turkorbit-api turkorbit-game
```
- Oyun sunucusu kapanırken bekleyen görev olaylarını yazıp öyle çıkar.
- Sunucu saat dilimi önemli değildir (hesaplar UTC üzerinden yapılır), ama saat **doğru** olmalıdır: `timedatectl set-ntp true`.

## 4. Değerleri değiştirme (Yönetim Merkezi gelene kadar, SQL ile)
- **Görev kuralları:** `game_settings` → `quests` (günlük/haftalık adet, yeniden çekme hakkı, sıfırlama saati, etkin görev sınırı, öldürme payı eşiği). Ayarlar her istekte okunur; yeni değer hemen geçerli olur.
- **Görev içeriği:**
  - Tablolar: `quests`, `quest_objectives` (hedef + `params` JSON + etiket), `reward_entries` (`quest.<kod>` ödül tablosu).
  - API ve oyun sunucusu içeriği 60 sn önbellekte tutar. Değişiklik en geç 60 sn sonra, hemen görmek için oyun sunucusu yeniden başlatılınca yansır.
  - Bir görevi kapatmak için: `UPDATE quests SET is_published = false WHERE code = '...'`.
- **Etkinlik tarihleri:** `quests.starts_at / ends_at`. Saatler UTC tutulur; örneğin 05:00 TSİ = 02:00 UTC.
- **Dikkat:** Oyuncunun etkin görevindeki bir hedefin `target` değerini düşürmek, ilerlemesi yeni hedefi geçmiş olsa da görevi kendiliğinden tamamlamaz. Görev bir sonraki olayla tamamlanır.

## 5. Testler
```bash
npm test            # paylaşılan (döngü anahtarı, hedef eşleme) + API (görev servisi zaman taklidiyle, oyun sunucusu görev olayları)
npm run test:e2e    # API uçtan uca: görev listesi, kabul, oyunda NPC öldürünce canlı ilerleme, ödül, tekrar isteği
npm run test:ui     # tarayıcı: izleyici, Q çekmecesi, canlı ilerleme, ödül, görevler sayfası, telefonda kaydırma
```
