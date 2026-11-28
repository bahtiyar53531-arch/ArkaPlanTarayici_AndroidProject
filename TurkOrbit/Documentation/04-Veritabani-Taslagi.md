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
| [database/schema-draft.sql](../database/schema-draft.sql) | 📐 **Taslak** (Aşama 11–17). 0001 → 0006 zincirinin üzerine hatasız yüklendiği doğrulandı (toplam 94 tablo). Her aşamada ilgili bölüm gözden geçirilip yeni bir migration'a dönüştürülecek. |

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

## 2. Taslaktaki tablo grupları

| Grup | Tablolar | Aşama |
|---|---|---|
| Evren ve profil | ✅ 0002'de uygulandı; taslakta yalnızca `player_settings` ve sonraki aşamaların ekleyeceği sütunlar (`active_loadout`, `clan_id`, `reward_table_id`, `max_players`) | 5 ✅ / 6, 9, 12 |
| İçerik sürümleme | `content_revisions, approval_requests` | 14 (tasarım şimdiden) |
| Eşya, envanter, konfigürasyon, PET | ✅ 0003'te uygulandı | 6 ✅ |
| Yetenekler | `skill_nodes, player_skills` | 9 |
| Harita | ✅ `map_portals, map_zones` 0004'te uygulandı; taslakta `resource_nodes` (madencilik) | 7 ✅ / 11 |
| NPC ve kapılar | ✅ `npc_types, npc_spawns` 0005'te uygulandı; taslakta `gates, gate_waves, player_gates` (Yıldız Kapıları) | 9 ✅ / 10-11 |
| Ödüller | ✅ `reward_tables, reward_entries` 0005'te uygulandı | 9 ✅ |
| Görevler | ✅ `quests, quest_objectives, player_quests` + `player_quest_cycles` 0006'da uygulandı | 10 ✅ |
| Ekonomi | `currencies, wallets, currency_ledger, item_ledger, shop_categories, shop_offers, auctions, auction_bids, crafting_recipes, daily_login_rewards, player_daily_logins` | 11 |
| Sosyal | `clans, clan_ranks, clan_members, clan_applications, clan_diplomacy, clan_treasury_ledger, friendships, player_blocks, chat_messages, reports, notifications` | 12 |
| Etkinlik/sıralama | `events, leaderboard_snapshots` | 12 |
| Forum | `forum_categories, forum_moderators, forum_threads, forum_posts, forum_likes, forum_follows` | 13 |
| Destek | `support_tickets, support_messages, support_attachments` | 13 |
| Moderasyon | `sanctions, anticheat_events` | 14 |
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
