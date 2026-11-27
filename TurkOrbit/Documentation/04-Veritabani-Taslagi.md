# 04 — Veritabanı Taslağı

**Motor:** PostgreSQL 16 · **Uzantı:** `citext` (büyük/küçük harf duyarsız kullanıcı adı/e-posta) · **UUID:** `gen_random_uuid()` (yerleşik)

| Dosya | Durum |
|---|---|
| [database/migrations/0001_auth.sql](../database/migrations/0001_auth.sql) | ✅ **Uygulanan migration** (Aşama 1). Testler bu dosyayla kurulan gerçek veritabanında çalışır. |
| [database/migrations/0002_player_profile.sql](../database/migrations/0002_player_profile.sql) | ✅ **Uygulanan migration** (Aşama 5). |
| [database/migrations/0003_hangar.sql](../database/migrations/0003_hangar.sql) | ✅ **Uygulanan migration** (Aşama 6). |
| [database/schema-draft.sql](../database/schema-draft.sql) | 📐 **Taslak** (Aşama 7–17). 0001 + 0002 + 0003'ün üzerine hatasız yüklendiği doğrulandı (toplam 89 tablo). Her aşamada ilgili bölüm gözden geçirilip yeni bir migration'a dönüştürülecek. |

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

## 2. Taslaktaki tablo grupları

| Grup | Tablolar | Aşama |
|---|---|---|
| Evren ve profil | ✅ 0002'de uygulandı; taslakta yalnızca `player_settings` ve sonraki aşamaların ekleyeceği sütunlar (`active_loadout`, `clan_id`, `reward_table_id`, `max_players`) | 5 ✅ / 6, 9, 12 |
| İçerik sürümleme | `content_revisions, approval_requests` | 14 (tasarım şimdiden) |
| Eşya, envanter, konfigürasyon, PET | ✅ 0003'te uygulandı | 6 ✅ |
| Yetenekler | `skill_nodes, player_skills` | 9 |
| Harita | `maps, map_portals, map_zones, resource_nodes` | 7 |
| NPC ve kapılar | `npc_types, npc_spawns, gates, gate_waves, player_gates` | 9 |
| Ödüller | `reward_tables, reward_entries` | 9 |
| Görevler | `quests, quest_objectives, player_quests` | 10 |
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
