# 04 — Veritabanı Taslağı

**Motor:** PostgreSQL 16 · **Uzantı:** `citext` (büyük/küçük harf duyarsız kullanıcı adı/e-posta) · **UUID:** `gen_random_uuid()` (yerleşik)

| Dosya | Durum |
|---|---|
| [database/migrations/0001_auth.sql](../database/migrations/0001_auth.sql) | ✅ **Uygulanan migration** (Aşama 1). Testler bu dosyayla kurulan gerçek veritabanında çalışır. |
| [database/schema-draft.sql](../database/schema-draft.sql) | 📐 **Taslak** (Aşama 2–17). 0001'in üzerine hatasız yüklendiği doğrulandı (toplam 88 tablo). Her aşamada ilgili bölüm gözden geçirilip yeni bir migration'a dönüştürülecek. |

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

## 2. Taslaktaki tablo grupları

| Grup | Tablolar | Aşama |
|---|---|---|
| Evren | `game_servers, companies` | 5 |
| Profil | `players, player_stats, ranks, achievements, player_achievements, player_settings` | 5 |
| İçerik sürümleme | `content_revisions, approval_requests` | 14 (tasarım şimdiden) |
| Eşya tanımları | `item_types, ship_types, upgrade_levels` | 6 |
| Oyuncu envanteri | `player_ships, player_items, loadout_slots (2 konfigürasyon), player_drones, player_pets, player_pet_modules` | 6 |
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
