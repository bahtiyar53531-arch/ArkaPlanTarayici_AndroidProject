# 04 — Veritabanı Taslağı

**Motor:** PostgreSQL 16 · **Uzantı:** `citext` (büyük/küçük harf duyarsız kullanıcı adı/e-posta) · **UUID:** `gen_random_uuid()` (yerleşik)

| Dosya | Durum |
|---|---|
| [database/migrations/0001_auth.sql](../database/migrations/0001_auth.sql) | ✅ **Uygulanan migration** (Aşama 1). Testler bu dosyayla kurulan gerçek veritabanında çalışır. |
| [database/migrations/0002_player_profile.sql](../database/migrations/0002_player_profile.sql) | ✅ **Uygulanan migration** (Aşama 5). |
| [database/migrations/0003_hangar.sql](../database/migrations/0003_hangar.sql) | ✅ **Uygulanan migration** (Aşama 6). |
| [database/migrations/0004_world.sql](../database/migrations/0004_world.sql) | ✅ **Uygulanan migration** (Aşama 7). |
| [database/migrations/0005_combat.sql](../database/migrations/0005_combat.sql) | ✅ **Uygulanan migration** (Aşama 9). |
| [database/migrations/0006_quests.sql](../database/migrations/0006_quests.sql) | ✅ **Uygulanan migration** (Aşama 10). |
| [database/migrations/0007_economy.sql](../database/migrations/0007_economy.sql) | ✅ **Uygulanan migration** (Aşama 11). |
| [database/migrations/0008_social.sql](../database/migrations/0008_social.sql) | ✅ **Uygulanan migration** (Aşama 12). |
| [database/migrations/0009_forum_support.sql](../database/migrations/0009_forum_support.sql) | ✅ **Uygulanan migration** (Aşama 13). |
| [database/migrations/0010_admin.sql](../database/migrations/0010_admin.sql) | ✅ **Uygulanan migration** (Aşama 14). |
| [database/schema-draft.sql](../database/schema-draft.sql) | 📐 **Taslak** (Aşama 15–17). 0001 → 0010 zincirinin üzerine hatasız yüklendiği doğrulandı (toplam 100 tablo). Her aşamada ilgili bölüm gözden geçirilip yeni bir migration'a dönüştürülecek. |

## 1. Uygulanan tablolar (0001)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `users` | Hesap | `username`/`email` citext + UNIQUE; `public_id` = gösterilen Oyuncu ID (100001'den başlar); `status` ∈ active/suspended/banned/deleted; askıda ise bitiş tarihi zorunlu |
| `roles`, `permissions`, `role_permissions` | RBAC kataloğu | 9 rol, 48 yetki; tohum verisi `packages/shared/src/roles.ts` ile birebir aynı (test doğrular) |
| `user_roles` | Kullanıcının rolleri | Yeni kullanıcıya **tetikleyiciyle** yalnızca `player` |
| `sessions` | Oturumlar | `token_hash` (SHA-256), `transport` cookie/token, platform, cihaz, IP, son etkinlik, mutlak bitiş, iptal nedeni |
| `email_verification_tokens`, `password_reset_tokens` | Tek kullanımlık bağlantılar | Yalnızca özet saklanır; yeni bağlantı eskileri geçersiz kılar; `FOR UPDATE` ile çift kullanım engellenir |
| `login_events` | Giriş geçmişi | Başarılı/başarısız, neden, IP, cihaz, şüpheli bayrağı ve nedenleri; **parola asla yazılmaz** |
| `user_known_devices` | Şüpheli giriş tespiti | Kullanıcı + cihaz parmak izi |
| `game_settings` | Oyun ayarları | `registration.enabled`, `terms.version` (Yönetim Merkezi 15.11'in temeli) |
| `admin_audit_log` | Yönetici işlem geçmişi | Önceki/yeni değer, gerekçe, sonuç; **UPDATE/DELETE tetikleyiciyle yasak** (yalnızca eklenebilir) |
| `schema_migrations` | Migration takibi | Dosya adı + SHA-256; uygulanmış dosya değişirse çalıştırıcı durur |

## 1b. Aşama 5'te uygulanan tablolar (0002)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `game_servers` | Oyun sunucuları | `TR1 Anadolu-1`; `is_open`, `is_maintenance` |
| `companies` | 3 şirket | Renk, slogan, açıklama, `home_map_id` (zorunlu) |
| `maps` | 21 haritanın temel kaydı | Tür, şirket, seviye şartı, PvP, doğma noktası; portal/NPC Aşama 7 |
| `ranks` | 18 rütbe | `min_points` artan ve benzersiz |
| `ship_types` | Gemi türleri | Şimdilik yalnızca başlangıç gemisi Kırlangıç; aynı anda tek `is_starter` |
| `players` | Pilot (sunucu başına bir) | `UNIQUE(user_id, server_id)`, `UNIQUE(server_id, pilot_name)`; **seviye ve rütbe puanı saklanmaz** |
| `player_stats` | Savaş/NPC istatistikleri | Tüm sayaçlar `>= 0`; yalnızca oyun sunucusu yazar |
| `player_ships` | Sahip olunan gemiler | `players.active_ship_id` FK |
| `achievements`, `player_achievements` | Başarımlar | `stat_key` ile istatistikten ilerleme |
| `currencies`, `wallets`, `currency_ledger` | Para | `balance >= 0`; defter UPDATE yasak; `idempotency_key` benzersiz |

## 1c. Aşama 6'da uygulanan tablolar (0003)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `item_types` | 36 eşyalık katalog | Kategori CHECK; `stats` kategori şemasıyla sunucuda doğrulanır; yalnızca mühimmat yığınlanır |
| `upgrade_levels` | Kategori bazlı yükseltme tablosu | Seviye 1–10: +%2/seviye, şans ve ücret |
| `player_items` | Envanter | Yığın satırı oyuncu başına tek (kısmi benzersiz dizin); yığın değilse adet 1 |
| `item_ledger` | Eşya defteri | UPDATE yasak; `idempotency_key` benzersiz |
| `item_upgrade_log` | Yükseltme denemeleri | Zar sonucu ve şans saklanır (denetim) |
| `loadout_slots` | İki konfigürasyon | Bir eşya aynı konfigürasyonda tek slotta |
| `player_pets`, `player_pet_modules` | PET | Oyuncu başına bir PET; modül tek slotta |
| `shop_categories`, `shop_offers`, `shop_purchases` | Mağaza | İndirim, paket, oyuncu sınırı, tarih aralığı; satın alma `idempotency_key` benzersiz |
| `players.active_loadout`, `player_ships.design_item_id` | Eklenen sütunlar | Tasarım tek gemide (UNIQUE) |

## 1d. Aşama 7'de uygulanan tablolar (0004)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `map_portals` | 60 geçit (30 çift yönlü bağlantı) | Harita başına hedef benzersiz; `requirements` ek şart; `is_enabled` ile kapatılabilir; varış noktası karşı geçidin 700 birim içi |
| `map_zones` | 51 bölge: istasyon, güvenli bölge, kaynak alanı, PvP yasak | Şekil şimdilik daire (`shape.type = 'circle'`) |
| `map_transitions` | Harita geçiş kaydı | Sebep: `portal`, `map_closed`, `company_change` |
| `position_rejections` | Hız denetiminden geçmeyen konumlar | Aşama 8'de hile olaylarına taşınacak |
| `player_settings` | Oyuncu ayarları | Birincil anahtar (kullanıcı, cihaz sınıfı); zod şemasıyla doğrulanır |
| `maps.galaxy_x/galaxy_y`, `players.pos_updated_at` | Eklenen sütunlar | Galaksi haritası düzeni; hız denetimi için son konum zamanı |

## 1e. Aşama 8 (yeni tablo yok)

Aşama 8'de veritabanı şeması değişmedi. Anlık oyun durumu bellekte (oyun sunucusu) ve Redis'te tutulur; kalıcı sonuçlar toplu yazılır.

| Redis anahtarı / kanalı | Amaç | Süre |
|---|---|---|
| `game:ticket:<sha256>` | Tek kullanımlık oyun bileti (kullanıcı, oturum, pilot, sunucu) | 60 sn, `GETDEL` ile tüketilir |
| `game:session:<oyuncu>` | Pilotun güncel oyun bağlantısı | 24 sa |
| `game:presence:<oyuncu>` | Çevrimiçi durum: harita, istasyonda mı, süreç | 30 sn (5 sn'de bir yenilenir) |
| kanal `game:kick` | Tek aktif oturum: eski bağlantıyı (hangi süreçte olursa) kapat | — |
| kanal `game:player-updated` | Hangar değişikliği → oyun sunucusu istatistikleri yeniden yükler | — |

## 1f. Aşama 9'da uygulanan tablolar (0005)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `npc_types` | 11 NPC türü (4 aile, 2 kadim/boss) | Can, kalkan, emme oranı, hasar, atış aralığı, menzil, hız; `ai` JSON (`behavior`: `passive` / `aggressive` / `kite`, sürü, zehir, yavaşlatma, bağ mesafesi); deneyim, şeref, ödül tablosu |
| `reward_tables`, `reward_entries` | Ödül tabloları (52 satır) | Tür: para, eşya, deneyim, şeref, kaynak; `min ≤ max`; `0 < chance ≤ 1`; `delivery`: `direct` (doğrudan) / `cargo` (kargo kutusu) |
| `npc_spawns` | 21 haritada 111 doğma alanı (en fazla 414 canlı NPC) | Alan dairesi, `max_alive`, `respawn_seconds`, `overrides` (harita bazlı çarpan), `is_enabled` |
| `combat_deaths` | Pilot ölüm kaydı | Harita, konum, öldüren türü (`npc` / `player` / `other`), NPC türü veya pilot |
| `npc_kill_log` | NPC öldürme kaydı | `kill_id` benzersiz: aynı öldürme iki kez ödüllenemez; ödül defterindeki `ref_id` ile aynı |
| `game_settings.combat` | Savaş ayarları | Yeniden doğma canı, kalkan yenilenmesi, kargo sahiplik/ömür süresi, PvP şerefi, hasar sapması |

Ödüller mevcut defterlere yazılır: `currency_ledger` (`npc_reward`), `item_ledger` (`cargo_loot`, `ammo_used`), `players.experience/honor`, `player_stats` (`npc_kills`, `player_kills`, `deaths`, `cargo_collected`).

## 1g. Aşama 10'da uygulanan tablolar (0006)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `quests` | 300 görev: 120 ana/zincir, 90 günlük, 60 haftalık, 30 etkinlik | Kategori CHECK; etkinlikte `starts_at/ends_at` zorunlu ve `ends_at > starts_at`; zincir `prerequisite_quest_id`; günlük/haftalık havuzda `min_level–max_level` bandı; `reward_table_id` (0005 ödül tabloları) |
| `quest_objectives` | 338 hedef | 11 hedef türü (CHECK); `params` JSON nesnesi (`{c}` şirket öneki); `target > 0`; Türkçe etiket |
| `player_quests` | Oyuncu görev durumu | Benzersiz (oyuncu, görev, döngü); durum `active/completed/claimed/rerolled/abandoned`; tamamlananda `completed_at`, ödülü alınanda `claimed_at` zorunlu; ilerlemeyi yalnızca sunucu yazar |
| `player_quest_cycles` | Günlük/haftalık atama + yeniden çekme hakkı | Birincil anahtar (oyuncu, kategori, döngü) → döngü başına tek atama; `rerolls_used >= 0` |
| `game_settings.quests` | Görev kuralları | Günlük/haftalık adet, yeniden çekme, 05:00 TSİ, etkin görev sınırı, öldürme payı eşiği |

Görev ödülleri `currency_ledger` / `item_ledger` defterlerine `quest_reward` gerekçesiyle, idempotent anahtarla yazılır.

## 1h. Aşama 11'de uygulanan tablolar (0007)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `item_types` (`resource`) | 7 kaynak eşyası | Kategori ve yığın kısıtları `resource` ile genişletildi; Yıldız Özü `sell_price = 0` (satılamaz) |
| `resource_nodes` | 45 maden noktası grubu (en fazla 414 nokta) | Kaynak bölgelerinden üretildi; daire alan; `yield_max >= yield_min`; `is_enabled` |
| `crafting_recipes` | 12 tarif (4 rafineri, 8 atölye) | `inputs` JSON dizisi (boş olamaz); süre, seviye |
| `player_crafting_jobs` | Üretim kuyruğu | Başlatma anındaki çıktı saklanır; `ready_at >= started_at`; `idempotency_key` benzersiz; teslimde `claimed_at` zorunlu |
| `auction_lots` | 9 açık artırma lotu | Tür saatlik/günlük/haftalık; taban fiyat > 0 |
| `auctions` | Dönem açık artırmaları | `UNIQUE (server_id, lot_id, period_key)`; `ends_at > starts_at`; teklif ≥ taban |
| `auction_bids` | Teklifler | `idempotency_key` benzersiz; iade edilen teklif `refunded` |
| `daily_login_rewards`, `player_daily_logins` | 7 günlük takvim, oyuncu girişleri | Birincil anahtar (oyuncu, oyun günü) → günde tek ödül |
| `shop_offers` (paket) | `title`, `description`, `bundle_items` | `offer_type = 'bundle'` için içerik zorunlu (CHECK) |

## 1i. Aşama 12'de uygulanan tablolar (0008)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `clans` | Klanlar | Etiket `^[A-Z0-9ÇĞİÖŞÜ]{2,5}$`, ad 3–30; sunucu başına etiket ve ad benzersiz (citext); vergi 0–5; `leader_id` pilot silinirse NULL |
| `clan_ranks` | Rütbeler | Yetki listesi yalnızca bilinen 6 yetki (CHECK); sıra 0 = lider; `UNIQUE (clan_id, sort_order)` |
| `clan_members` | Üyeler | `player_id` UNIQUE → tek klan; rütbe aynı klana ait (bileşik FK) |
| `clan_applications`, `clan_invitations` | Başvuru ve davet | Bekleyen kayıt (klan, pilot) başına tek (kısmi benzersiz dizin); davet süreli |
| `clan_diplomacy` | İttifak, saldırmazlık, savaş | Çift başına tek satır (`clan_a < clan_b`); savaş yalnızca `active`; barış önerisi yalnızca savaşta |
| `clan_wallets`, `clan_treasury_ledger` | Hazine ve defteri | `balance >= 0`; defter yalnızca eklenebilir (tetikleyici); `idempotency_key` benzersiz |
| `clan_events` | Klan etkinlik kaydı | Adlar o anki haliyle saklanır |
| `friendships` | Arkadaşlık | İstek (gönderen → alan, `pending`); kabulde iki yönlü `accepted` |
| `player_blocks` | Engelleme | Kendini engelleyemez (CHECK) |
| `player_social_settings` | Gizlilik | Konum paylaşımı, çevrimiçi görünürlük, özel mesaj, grup daveti, arkadaşlık isteği |
| `chat_messages` | Sohbet kaydı | Kanal adı biçimi CHECK; özel mesajda alıcı zorunlu; gövde 1–300; `filtered` işareti |
| `reports` | Şikâyet kuyruğu | Hedef türü ve sebep CHECK; anlık `snapshot`; aynı kişi + içerik için tek açık şikâyet |
| `notifications` | Bildirimler | Bağlantı yalnızca site içi yol (CHECK); okunmamış için kısmi dizin |

Gruplar (party) tablo değildir: canlı durum Redis'te (`party:*`). Grup mesajları `chat_messages` içinde `group:<id>` kanalıyla saklanır.

## 1j. Aşama 13'te uygulanan tablolar (0009)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `forum_categories` | Bölümler | `slug` biçimi CHECK ve benzersiz; `post_permission` → `permissions(key)` (konuyu kimin açabileceği; ör. Duyurular için `forum.moderate`); arşiv |
| `forum_moderators` | Bölüm moderatörleri | Birincil anahtar (bölüm, kullanıcı); atayan kaydedilir |
| `forum_threads` | Konular | Başlık 5–140; sabit/kilitli/silinmiş işaretleri; `reply_count`, `view_count ≥ 0`; yazar silinirse NULL; `search` üretilen sütun (`simple` tsvector, GIN dizini) |
| `forum_posts` | Mesajlar | Gövde 1–20.000; konu başına tek `is_first` (kısmi benzersiz dizin); alıntı aynı konuda; yumuşak silme (silen ve sebep); `search` üretilen sütun |
| `forum_likes`, `forum_follows` | Beğeni ve takip | Birincil anahtar (mesaj/konu, kullanıcı) → kişi başına tek |
| `support_tickets` | Talepler | `ticket_no` CHECK `^TO-[0-9]{4}-[0-9]{6,}$` ve UNIQUE (`support_ticket_seq` dizisinden); konu türü, durum ve öncelik CHECK; platform/sürüm; `resolved_at`, `closed_at` |
| `support_messages` | Talep mesajları | Gövde 1–5.000; iç not yalnızca personel mesajında (CHECK) |
| `support_attachments` | Ek dosya kayıtları | İçerik veritabanında **değil**: `storage_key` biçimi CHECK, tür CHECK (5 tür), boyut 1 bayt–10 MB, SHA-256 32 bayt |

Ek dosyaların kendisi `UPLOAD_DIR` altındaki dosya deposundadır (bkz. [Aşama 13 kuralları](Asama-13-Forum-Destek/Forum-ve-Destek-Kurallari-ve-API.md)).

## 1k. Aşama 14'te uygulanan tablolar (0010)

| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `sanctions` | Yaptırım geçmişi (uyarı, susturma, askı, ban, kilit) | Süreli olanlarda bitiş zorunlu, banda süre yok (CHECK); veren ve kaldıran kişi + gerekçe; kaynak şikâyet; etkin susturma için kısmi dizin. Hesap durumu `users` alanlarında |
| `content_revisions` | İçerik sürümleri (NPC, gemi, mağaza, görev, harita, ayar) | Kayıt başına tek taslak ve tek yayın (kısmi benzersiz dizinler); `base_version` ile iyimser kilit; tam veri JSON |
| `approval_requests` | İki yetkili onayı | `approval_two_person` CHECK: onaylayan ≠ talep eden; işlem türü CHECK; süre; sonuç JSON |
| `reports.resolution_note` | Şikâyet kararı notu | ≤ 500 karakter |

Ayarlar: `maintenance` (bakım modu) ve `admin` (onay eşikleri, onay süresi). Oyun sunucusu süreç nabzı tablo yerine Redis'te (`game:node:*`, K-100).

## 2. Taslaktaki tablo grupları

| Grup | Tablolar | Aşama |
|---|---|---|
| Evren ve profil | ✅ 0002'de uygulandı; taslakta yalnızca `player_settings` ve sonraki aşamaların ekleyeceği sütunlar (`active_loadout`, `reward_table_id`, `max_players`); klan üyeliği `players.clan_id` yerine `clan_members` ile tutuldu | 5 ✅ / 6, 9 |
| İçerik sürümleme | ✅ `content_revisions, approval_requests` 0010'da uygulandı | 14 ✅ |
| Eşya, envanter, konfigürasyon, PET | ✅ 0003'te uygulandı | 6 ✅ |
| Yetenekler | `skill_nodes, player_skills` | 9 |
| Harita | ✅ `map_portals, map_zones` 0004'te, `resource_nodes` 0007'de uygulandı | 7 ✅ / 11 ✅ |
| NPC ve kapılar | ✅ `npc_types, npc_spawns` 0005'te uygulandı; taslakta `gates, gate_waves, player_gates` (Yıldız Kapıları) | 9 ✅ / 10-11 |
| Ödüller | ✅ `reward_tables, reward_entries` 0005'te uygulandı | 9 ✅ |
| Görevler | ✅ `quests, quest_objectives, player_quests` + `player_quest_cycles` 0006'da uygulandı | 10 ✅ |
| Ekonomi | ✅ Cüzdan/defter/mağaza 0002–0003'te; açık artırma, üretim, günlük ödül, paketler 0007'de uygulandı | 11 ✅ |
| Sosyal | ✅ 0008'de uygulandı (+ `clan_invitations, clan_wallets, clan_events, player_social_settings`) | 12 ✅ |
| Etkinlik/sıralama | `events, leaderboard_snapshots` | 14 (07'deki Aşama 12 kapsamında değil) |
| Forum | ✅ 0009'da uygulandı (6 tablo) | 13 ✅ |
| Destek | ✅ 0009'da uygulandı (3 tablo + `support_ticket_seq`) | 13 ✅ |
| Moderasyon | ✅ `sanctions` 0010'da uygulandı; taslakta `anticheat_events` | 14 ✅ / 16 |
| Sistem/platform | `feature_flags, client_releases, maintenance_windows, server_nodes, client_error_reports, backups` | 14-15 |

## 3. Tasarım kuralları

1. **Tanım ↔ durum ayrımı:** İçerik (`ship_types`, `npc_types`, `quests`…) Yönetim Merkezi'nden düzenlenir. Oyuncu durumu (`player_items`, `wallets`, `player_quests`…) yalnızca oyun servisleriyle değişir.
2. **Para ve eşya güvenliği:** `wallets.balance >= 0` kısıtı vardır. Her değişiklik aynı transaction'da defter kaydı (`currency_ledger`/`item_ledger`) ve benzersiz `idempotency_key` ile yazılır. Ağ tekrarında veya çift tıklamada işlem iki kez uygulanmaz.
3. **NPC yeniden kullanımı:** `npc_types` bir kez tanımlanır. Haritalar (`npc_spawns.overrides`) ve kapı dalgaları (`gate_waves.composition`) aynı türü çarpanlarla yeniden kullanır, içerik çoğaltılmaz.
4. **Anlık oyun durumu veritabanında değildir:** Konum, can ve cephane oyun sunucusu belleğinde/Redis'tedir. Veritabanına yalnızca kalıcı sonuçlar yazılır.
5. **Silme yerine arşiv:** İçerik kayıtlarında `is_archived` kullanılır. Geçmiş oyuncu kayıtlarının referansları kırılmaz.
6. **Zaman damgaları** `timestamptz` (UTC) olarak saklanır. Kullanıcıya TSİ (Europe/Istanbul) gösterilir.

## 4. Yedekleme planı (Aşama 16)
- Günlük `pg_dump` (sıkıştırılmış, şifreli) + sürekli WAL arşivi (zamana dönük kurtarma).
- Yedekler sunucu dışındaki nesne depolamada tutulur ve `backups` tablosuna kaydedilir.
- Aylık geri yükleme tatbikatı: yedek ayrı bir sunucuya açılıp sağlık testi çalıştırılır.
