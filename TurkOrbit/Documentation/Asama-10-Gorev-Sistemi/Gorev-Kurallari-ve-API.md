# Aşama 10 — Görev Sistemi: Kurallar, İçerik ve API

**Kurallar:** `packages/shared/src/quests.ts` · **Servis:** `apps/api/src/modules/quest/service.ts` · **Uçlar:** `apps/api/src/modules/quest/routes.ts`
**Veri:** `database/migrations/0006_quests.sql` · **Oyun sunucusu:** `apps/api/src/game/server.ts` (olaylar)

> **İlke:** Görev ilerlemesi **yalnızca sunucuda** hesaplanır ve yazılır. İstemcinin ilerleme gönderebileceği bir uç yoktur (`POST /quests/progress` → 404, testli).
> İlerleme iki kaynaktan gelir: oyun sunucusu olayları (öldürme, kargo, ziyaret, hasar, yol, roket, geçit, seviye) ve hangar işlemleri (yükseltme, satın alma; aynı transaction'da).

## 1. Görev türleri

| Tür | Nasıl verilir | Sıfırlama | Not |
|---|---|---|---|
| **Ana ve zincir** (`main`) | Oyuncu kabul eder | Yok (bir kez) | Zincirde bir görev, öncekinin **ödülü alınınca** açılır. Seviye şartı varsa "N. seviyede açılır" görünür |
| **Günlük** (`daily`) | Otomatik: seviye bandına uygun havuzdan **3** görev | Her gün **05:00 TSİ** | Pilota özel, tohumlu seçim (aynı gün aynı görevler). Günde **1** yeniden çekme hakkı |
| **Haftalık** (`weekly`) | Otomatik: havuzdan **3** görev | Pazartesi **05:00 TSİ** | Haftada **1** yeniden çekme hakkı |
| **Etkinlik** (`event`) | Oyuncu kabul eder | Etkinlik penceresi | Yalnızca başlangıç–bitiş arasında kabul edilir ve ilerler. 14 gün içinde başlayacak etkinlik "kilitli" görünür |

- **Aynı anda etkin ana/etkinlik görevi:** en fazla 10 (`game_settings.quests.max_active`).
- **Bırakma:** ana ve etkinlik görevi bırakılabilir (ilerleme sıfırlanır, yeniden alınabilir). Günlük ve haftalık görev bırakılamaz; yeniden çekilir.
- **Süre dolunca:** Günlük/haftalık görevin döngüsü bittiğinde tamamlanmamış görev listeden kalkar. **Tamamlanmış ama ödülü alınmamış** görev listede kalır ve ödülü sonradan alınabilir (ödül kaybolmaz). Bitmiş etkinliğin tamamlanmış görevleri için de aynısı geçerlidir.

## 2. Döngü anahtarı (05:00 TSİ)
- Türkiye saati UTC+3'tür (yaz saati yok).
- Günlük anahtar `(şimdi + 3 sa − 5 sa)` anının UTC tarihidir: `2026-11-28`.
- Haftalık anahtar aynı anın ISO haftasıdır: `2026-W48`.
- Örnekler (testli):

| An | Günlük anahtar | Haftalık anahtar |
|---|---|---|
| 28.11 04:59 TSİ | `2026-11-27` | |
| 28.11 05:00 TSİ | `2026-11-28` | |
| Pazartesi 05:00 TSİ | | `2026-W49` |
| 01.01.2027 | | `2026-W53` |

- **Atama:** Döngünün ilk isteğinde yapılır. Bu istek görev listesi, oyuna giriş ya da bir oyun olayı olabilir.
- `player_quest_cycles` satırı (`ON CONFLICT DO NOTHING`) aynı döngünün iki kez atanmasını engeller; eşzamanlı istekler güvenlidir.
- **Tohumlu seçim:** Seçim `pilotId:kategori:döngü` tohumuyla yapılır (FNV-1a + mulberry32). Aynı pilot aynı gün hep aynı görevleri görür.
- **Yeniden çekme:** Bu döngüde verilmiş görevler havuzdan çıkarılır, kalanlardan yeni bir tohumla seçilir.

## 3. Hedef türleri ve olay kaynakları

| Hedef | Kaynak | Koşullar (`params`) | Not |
|---|---|---|---|
| `kill_npc` | Oyun sunucusu, NPC ölümü | `npc`, `family`, `boss`, `maps`, `map_types` | En çok hasar verene ve payı **≥ %20** olan pilotlara sayılır (`kill_credit_min_share`) |
| `kill_player` | Oyun sunucusu, PvP | `maps`, `map_types` | Yenen pilota |
| `collect_cargo` | Oyun sunucusu, kargo kutusu | `maps`, `map_types` | Toplayana |
| `visit_map` | Oyuna giriş, geçit, yeniden doğma, bakım taşıması | `maps` | Bulunulan harita da sayılır |
| `deal_damage` | NPC'ye / pilota verilen hasar | `target` (`npc` / `player`), `family` | Kalkan + gövde |
| `travel_distance` | Sunucu hareket simülasyonu | `maps`, `map_types` | Birim; ışınlanma sayılmaz |
| `fire_rockets` | Roket atışı | `rocket` | |
| `jump_portal` | Geçitten geçiş | `maps` (varış) | |
| `upgrade_item` | Hangar, **başarılı** yükseltme | `min_level`, `category` | Başarısız deneme sayılmaz; tekrar isteği iki kez sayılmaz |
| `buy_item` | Mağaza satın alma | `category` (`ammo`, `rocket`…) | Tekrar isteği (aynı `requestId`) iki kez sayılmaz |
| `reach_level` | Seviye atlama (NPC ödülü, görev ödülü) | — | İlerleme "en yüksek değer"dir; kabul anında hemen değerlendirilir |

- **`{c}` yer tutucusu:** Pilotun şirket önekiyle değiştirilir. Kızılelma → `K`, Gökbörü → `G`, Altay → `A`. Örnek: `{c}-2` → `G-2`. Başlık, açıklama ve hedef etiketinde de çözülür.
- **Henüz olmayan hedefler:** `collect_resource` (madencilik, Aşama 11) ve `complete_gate` (Yıldız Kapıları) içerikte **yoktur**. Bu sistemler gelince eklenecek.

### Oyun sunucusunda verimlilik
- Pilot bağlanınca etkin (tamamlanmamış) hedefleri belleğe yüklenir. Bir olay **yalnızca bu hedeflerle eşleşirse** biriktirilir.
- Biriken olaylar saniyede bir, pilot çıkarken ve sunucu kapanırken tek transaction'da yazılır.
- Bu yüzden her lazer atışı veya her adım veritabanına gitmez. Görevi olmayan pilot hiç yazım üretmez.
- Hangarda görev kabul etmek, ödül almak veya görevi ilerleten bir işlem yapmak oyun sunucusuna `quests` gerekçesiyle bildirilir. Hedefler, seviye ve envanter anında yenilenir.
- Yeni günlük/haftalık döngü başlayınca sunucu bunu fark eder ve görevleri yeniden yükler. İstemciye `quests` mesajı gider.

## 4. Ödül
- Ödüller `reward_tables` / `reward_entries` (0005) satırlarıdır. Görevde sabit miktardır (min = max, şans 1).
- "Ödülü al" işlemi tek transaction'da yapılır:
  - görev satırı kilitlenir (`FOR UPDATE`);
  - durum `completed` değilse 409 döner;
  - para `currency_ledger`'a, eşya `item_ledger`'a yazılır (`quest_reward`, idempotent anahtar `quest:<pilot>:<görev>:<döngü>:<kod>`);
  - deneyim ve şeref eklenir;
  - durum `claimed` olur.
- **Eşzamanlı iki istek** gelirse biri ödülü alır, diğeri `replay: true` döner. Defterde tek kayıt oluşur (testli).
- **Seviye atlarsa** etkin "seviyeye ulaş" hedefleri aynı transaction'da güncellenir ve başarımlar değerlendirilir.
- **Başarımlar artık anında:** NPC öldürme, PvP, kargo, seviye atlama ve görev ödülünden sonra değerlendirilir. Yeni başarım oyunda "Başarım kazanıldı: …" bildirimiyle gelir. Aşama 5'te başarımlar yalnızca profil açılınca değerlendiriliyordu.

## 5. REST uçları (`/api/v1`, oturum gerekir; POST'larda CSRF)

| Uç | Gövde | Yanıt |
|---|---|---|
| `GET /quests?server=TR1` | — | `{ quests: QuestsResponse }` |
| `POST /quests/accept` | `{ serverCode, code }` | `{ quests }` |
| `POST /quests/abandon` | `{ serverCode, code }` | `{ quests }` |
| `POST /quests/reroll` | `{ serverCode, code }` | `{ replacedBy, quests }` |
| `POST /quests/claim` | `{ serverCode, code, cycle? }` | `{ quest, reward: { xp, honor, currencies[], items[], level, levelUp }, replay, quests }` |

`QuestsResponse`:
- `serverTime`, `level`
- `cycles` — `daily`, `weekly`, `nextDailyReset`, `nextWeeklyReset`
- `rerolls` — `daily` ve `weekly` için `{used, max}`
- `maxActive`, `activeCount`
- `quests[]` (`QuestView`), her biri:
  - `code`, `category`, `title`, `description`, `status`, `cycle`, `minLevel`, `lockedReason`
  - `chain` — `{code, order, total}`
  - `objectives[]` — `{id, type, label, current, target}`
  - `rewards[]` — `{type, code, name, amount}`
  - `startsAt`, `endsAt`, `completedAt`, `claimedAt`

`status`: `available` · `locked` · `active` · `completed` (ödül hazır) · `claimed`.

| Hata kodu | Durum | Ne zaman |
|---|---|---|
| `QUEST_NOT_FOUND` | 404 | Kod yok |
| `QUEST_UNAVAILABLE` | 400/409 | Seviye düşük, zincirde önceki görev bitmedi, etkinlik kapalı, zaten listede |
| `QUEST_LIMIT` | 409 | Etkin ana/etkinlik görevi sınırı |
| `QUEST_NOT_ACTIVE` | 409 | Bırakılacak/yeniden çekilecek görev etkin değil |
| `QUEST_NOT_COMPLETED` | 409 | Tamamlanmamış görevin ödülü istendi |
| `REROLL_LIMIT` | 409 | Yeniden çekme hakkı bitti |
| `VALIDATION_ERROR` | 400 | Bilinmeyen alan (ör. `progress`) gönderildi |

## 6. WebSocket ekleri (protokol sürümü 2'de, geriye uyumlu)

| Mesaj | Alanlar | Açıklama |
|---|---|---|
| `qp` | `u[]`: `{code, title, category, cycle, status, objectives[{id,current,target}]}` | Yalnızca değişen görevler; saniyede en fazla bir |
| `quests` | — | Görev listesi değişti (kabul, ödül, yeni döngü); istemci `GET /quests` ile yeniler |
| `notice` | `"Görev tamamlandı: … Ödülünü görev listesinden al."` / `"Başarım kazanıldı: …"` | Bildirim |

## 7. İçerik (0006_quests.sql — 300 görev)

| Tür | Adet | İçerik |
|---|---|---|
| Ana zincir **Büyük Sıçrama** | 40 | Eğitim → şirket kuşağı → Akkor/Fetih → sınır kuşağı → Çekirdek; 15. seviyede biter (son ödül: Gece Kırlangıcı tasarımı) |
| Yan zincirler | 80 | Çakal Avcısı (12) · Akrep Zehri (12) · Örümcek Ağı (12) · Gece Kanatları (10) · Sınır Devriyesi (10) · Çekirdeğe Yolculuk (8) · Usta Nişancı (8: roket, hasar, yükseltme, mağaza) · Şirket Onuru (8: PvP) |
| Günlük havuz | 90 | 4 seviye bandı: 1–6 (22), 5–10 (23), 8–13 (22), 12+ (23) |
| Haftalık havuz | 60 | 4 seviye bandı × 15 |
| Etkinlik | 30 | Açılış Şenliği (28.11.2026–01.01.2027) · Kış Gündönümü Seferi (19–28.12.2026) · Yılbaşı Filosu (30.12.2026–05.01.2027) · Nevruz Bahar Şenliği (19–26.03.2027) · Cumhuriyet Bayramı Filosu (28.10–02.11.2027); her biri 6 görev |

- 338 hedef: `kill_npc` 140, `visit_map` 50, `collect_cargo` 32, `deal_damage` 26, `travel_distance` 22, `fire_rockets` 17, `kill_player` 16, `jump_portal` 12, `buy_item` 9, `upgrade_item` 8, `reach_level` 6.
- **Ödül hesabı:** Üretici (`gen_quests.py`), her hedefin tahmini emeğini bant başına "dakikada deneyim" ile hesaplar. Ödül bu emeğin bir oranıdır: ana %50, günlük %35, haftalık %40, etkinlik %40.
- **Ödül içeriği:**
  - Kredi, deneyimin %80'i kadardır.
  - Haftalık görevler kademeye göre 10–50 Akçe verir.
  - Zincir sonları ve etkinlikler Akçe, roket veya tasarım verir.
  - Şirket Onuru zinciri ve PvP görevleri şeref verir.
- **Denge notu:** Değerler ilk ayardır. Yönetim Merkezi (Aşama 14) ile canlı oyuncu verisine göre ayarlanacak.

## 8. Ayarlar (`game_settings.quests`)
```json
{"daily_count": 3, "weekly_count": 3, "daily_rerolls": 1, "weekly_rerolls": 1, "reset_hour_tr": 5,
 "max_active": 10, "kill_credit_min_share": 0.2}
```

## 9. İstemci
- **Görevler sayfası** (`/gorevler`):
  - Sekmeler: Ana ve zincir · Günlük · Haftalık · Etkinlik. Ödülü hazır görev sayısı sekmede rozet olarak görünür.
  - Yenilenme geri sayımı ve yeniden çekme hakkı gösterilir.
  - Kartta hedef çubukları, ödül etiketleri ve Kabul et / Bırak / Yeniden çek / Ödülü al butonları vardır. Tamamlanan görevler açılır kapanır listededir.
- **Oyunda:**
  - **Q** tuşu (ayarlardan değiştirilebilir) veya 📜 butonu görev çekmecesini açar. Telefonda çekmece tam ekrandır ve kaydırılır.
  - Sol üstteki **görev izleyici**, ödülü hazır ve etkin görevleri gösterir (masaüstünde 3, telefonda 2). Tıklayınca çekmece açılır.
  - İlerleme `qp` mesajıyla anında güncellenir.
