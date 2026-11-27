# 01 — Araştırma Raporu: Uzay MMO İşlevsel Sistem Analizi

> **Amaç:** DarkOrbit (Bigpoint) türündeki uzay MMO oyunlarının *işlevsel* sistemlerini inceleyip Türk Orbit için **özgün** bir tasarım çıkarmak. Telifli kod, görsel, logo, isim ve metinler kopyalanmaz. Türk Orbit'in kendi adları için bkz. [08-Ozgun-Dunya-Taslagi.md](08-Ozgun-Dunya-Taslagi.md).

## 1. Kaynaklara erişim durumu (dürüst rapor)

Bu oturumun ağ politikası oyunun resmî alan adlarına doğrudan bağlantıyı **engelledi**. İnceleme bu yüzden **web araması sonuç özetleri** üzerinden yapıldı. Sayfaların tam metni okunamadı.

| Kaynak | Durum | Elde edilen |
|---|---|---|
| `www.darkorbit.com` (resmî site) | ❌ Erişilemedi (vekil sunucu 403 / DNS hatası) | — |
| `board-en.darkorbit.com` (İngilizce forum) | ⚠️ Yalnızca arama özetleri | "FAQ: Season Pass" (Şubat–Nisan 2026 sezonu), Skylab rehberi, PvP istatistik konusu |
| `board-tr.darkorbit.com` (Türkçe forum) | ❌ Erişilemedi, aramada da sonuç çıkmadı | — |
| `darkorbitwiki.com` (topluluk wikisi) | ⚠️ Yalnızca arama özetleri | Başlangıç rehberi, kapılar, lazer/mermi, teknik eşyalar, P.E.T., rütbe |
| `darkorbit.fandom.com` (topluluk wikisi) | ⚠️ Yalnızca arama özetleri | Boss NPC, harita portalları, kapı sayısı (2019 tarihli) |
| Wikipedia "DarkOrbit" | ⚠️ Yalnızca arama özetleri | Şirketler, para birimleri, klan vergisi, sıralama formülü |
| Steam mağaza sayfası | ⚠️ Yalnızca arama özeti | "DarkOrbit Reloaded" uygulamasının Steam'de bulunduğu |
| SSS / resmî yardım sayfaları | ❌ Erişilemedi | — |

**Bu belgedeki bilgilerin üç güven seviyesi vardır:**
- **[K] Kaynakta görüldü:** arama özetinde açıkça yer alan bilgi (kaynağı yanında belirtildi).
- **[G] Genel tür bilgisi:** uzay MMO türünde yaygın bilinen, ancak bu oturumda kaynaktan doğrulanamayan bilgi.
- **[B] Belirsiz / çelişkili:** kaynaklar arasında uyuşmazlık var ya da güncel olmayabilir.

> **Sonraki adım önerisi:** Ortamın ağ izinlerine yukarıdaki alan adları eklenirse rapor resmî sayfalardan doğrulanıp güncellenecek. Türk Orbit tasarımı bu belirsizliklerden etkilenmeyecek şekilde **kendi kurallarıyla** yazıldı.

## 2. Kaynaklardan doğrulanan temel bulgular

- Oyun ücretsiz (free-to-play), isteğe bağlı aylık "Premium" aboneliği var **[K: Wikipedia]**.
- Başlangıçta 3 şirketten biri seçiliyor **[K: Wikipedia / topluluk]**.
- Ana para birimleri: Kredi (kolay kazanılan) ve Uridium (değerli, zor kazanılan); Uridium takas edilemiyor **[K: wiki aynası]**.
- Her şirketin 4 alt + 4 üst haritası var (x-1 … x-8), 4-x haritaları PvP savaş haritaları **[K: topluluk]**; üst haritalara erişim seviye şartına bağlı, düşman şirket haritalarına daha yüksek seviye gerekiyor **[K: fandom 3-8 sayfası]**. Açılış seviyeleri kaynaklar arasında **çelişkili [B]**.
- Galaksi kapıları: parça toplanarak inşa edilen, NPC dalgaları içeren ayrı haritalar; içeride yalnızca NPC'ler var, çıkış ya yok edilerek ya da tüm dalgalar bitirilerek **[K: topluluk]**. Parça sayıları kapıya göre değişiyor (ör. 21, 111) **[K]**; 2019 tarihli kaynak 21 kapı sayıyor **[B: güncel olmayabilir]**.
- Sezon bileti: Günlük, Haftalık ve Sezon görevleri; görevler doğrudan ödül değil sezon puanı veriyor; günlük görevler sunucu yeniden başlatmasıyla sıfırlanıyor; sınırlı "yeniden çekme" hakkı var; ücretsiz ve ücretli iki ödül yolu **[K: resmî forum FAQ, Şubat 2026]**.
- Klan: katılım ücreti ve %0–5 klan vergisi (günlük hazineye) **[K: Wikipedia]**.
- Sıralama: deneyim/100.000 + şeref/100 gibi bir "üst kullanıcı puanı" ve günde bir kez hesaplanan rütbe puanı; negatif şeref PvP lazer hasarını düşürüyor **[K: wiki, Wikipedia]**.
- Maden/rafineri zinciri: 3 temel cevher → 2 ara ürün → 1 üst ürün → satılamayan özel güçlendirici; rafineri tesisi en fazla seviye 20 **[K: resmî forum Skylab rehberi]**.
- Mermiler hasarı çarpan olarak artırıyor; özel mermiler (ör. kalkan emen) var; roketlerin bazıları dondurma gibi durum etkisi uyguluyor; çoklu roket atarında tek tek roketler %75–100 hasar verebiliyor **[K: wiki, resmî forum]**.
- P.E.T. kendini tamir edemiyor, ayrı bir "tamir dişlisi" modülü gerekiyor **[K: wiki]**. Pilot yetenek ağacı "pilot puanı" ile açılıyor **[K: wiki]**.
- Konfigürasyon 1/2 ve açık artırma saatlik/günlük/haftalık takvimi aramalarda **doğrulanamadı [G/B]**.

## 3. 24 sistemin analizi ve Türk Orbit uyarlaması

Her sistem için: **İşleyiş** (türdeki genel işleyiş) · **Oyuncu akışı** · **Arayüz** · **Veritabanı** · **Backend** · **Güvenlik** · **Türk Orbit kararı**. Tablo adları [database/schema-draft.sql](../database/schema-draft.sql) ile aynıdır.

### 3.1 Kayıt ve giriş — ✅ Aşama 1'de uygulandı
- **İşleyiş [G]:** Web sitesinden kullanıcı adı + e-posta + parola ile kayıt, e-posta doğrulama, şifre sıfırlama.
- **Oyuncu akışı:** Kayıt → doğrulama e-postası → giriş → (Aşama 5) sunucu ve şirket seçimi.
- **Arayüz:** Kayıt/giriş/şifre sıfırlama/hesap güvenliği ekranları (mobil uyumlu).
- **Veritabanı:** `users, sessions, email_verification_tokens, password_reset_tokens, login_events, user_known_devices, user_roles`.
- **Backend:** Argon2id, opak oturum anahtarı (yalnızca SHA-256 özeti saklanır), Redis hız sınırı.
- **Güvenlik:** CSRF, Origin denetimi, hesap varlığını sızdırmayan yanıtlar, kilit, şüpheli giriş bildirimi.
- **Türk Orbit kararı:** Tek hesap tüm platformlarda geçerli. Web için çerez, mobil/masaüstü uygulama için Bearer anahtar.

### 3.2 Oyuncu profili — Aşama 5
- **İşleyiş [G]:** Seviye, deneyim, şeref, rütbe, oyun süresi, istatistikler, başarımlar.
- **Oyuncu akışı:** İlk girişte sunucu + şirket seçimi → başlangıç gemisi ve başlangıç haritası.
- **Arayüz:** Profil kartı, istatistik sekmesi, başarımlar, rütbe ilerlemesi.
- **Veritabanı:** `players, player_stats, ranks, achievements, player_achievements`.
- **Backend:** Rütbe puanı gece işinde (worker) hesaplanır; profil API'si önbellekli.
- **Güvenlik:** İstatistikler yalnızca oyun sunucusu tarafından yazılır; istemci yazamaz.
- **Türk Orbit kararı:** Bir hesapta sunucu başına bir pilot. Profil tüm cihazlarda aynı.

### 3.3 Şirket ve sunucu sistemi — Aşama 5
- **İşleyiş [K]:** 3 şirket. Şirketin kendi bölgesi var, düşman bölgelere seviye şartıyla girilir.
- **Oyuncu akışı:** Şirket seçimi kalıcıdır; değiştirmek maliyetli/sınırlı bir işlemdir.
- **Arayüz:** Şirket tanıtım ekranı (renk, felsefe, başlangıç bölgesi).
- **Veritabanı:** `companies, game_servers, players.company_id`.
- **Backend:** Şirket değişimi transaction + bekleme süresi + denetim kaydı.
- **Güvenlik:** Şirket değişimi kötüye kullanımına karşı hız sınırı.
- **Türk Orbit kararı:** Kızılelma Konsorsiyumu, Gökbörü Filosu, Altay Madencilik Birliği (özgün).

### 3.4 Haritalar ve galaksi — Aşama 7
- **İşleyiş [K/B]:** Şirket başına alt/üst haritalar, ortak PvP haritaları, portallarla bağlantı, seviye şartı.
- **Oyuncu akışı:** Portala yaklaş → geçiş koşulu denetimi → yükleme → yeni harita odası.
- **Arayüz:** Galaksi haritası, mini harita, portal göstergesi.
- **Veritabanı:** `maps, map_portals, map_zones, resource_nodes`.
- **Backend:** Her harita bir "oda" (oyun sunucusu sürecinde), portal geçişinde sunucular arası devir.
- **Güvenlik:** Konum ve portal mesafesi sunucuda doğrulanır (ışınlanma hilesi engellenir).
- **Türk Orbit kararı:** Halka topolojisi: 3×4 ev haritası + 6 sınır haritası + 3 çekirdek PvP + etkinlik/kapı haritaları.

### 3.5 Hangar ve gemiler — Aşama 6
- **İşleyiş [K]:** Onlarca gemi, slot sayıları (lazer, jeneratör, ekstra), görünüm tasarımları.
- **Oyuncu akışı:** Mağazadan gemi al → hangarda aktif et → ekipmanı tak.
- **Arayüz:** Sürükle-bırak hangar (PC), dokunmatik seçim listesi (mobil).
- **Veritabanı:** `ship_types, player_ships, loadout_slots`.
- **Backend:** Hangar değişikliği yalnızca güvenli bölgede/istasyonda; sunucu slot uyumunu denetler.
- **Güvenlik:** Slot sayısı, sahiplik ve seviye şartı sunucuda kontrol edilir.
- **Türk Orbit kararı:** 10 özgün gemi sınıfıyla başlangıç (bkz. 08). Yönetim Merkezi'nden düzenlenebilir.

### 3.6 Silahlar ve lazerler — Aşama 6/9
- **İşleyiş [K]:** Lazer topu + mermi türleri (hasar çarpanı, kalkan emme gibi özel etkiler).
- **Oyuncu akışı:** Hedef seç → otomatik ateş (saniyelik döngü) → mermi türünü hızlı değiştir.
- **Arayüz:** Mermi çubuğu (1-9 kısayol / dokunmatik butonlar).
- **Veritabanı:** `item_types (category: laser, ammo)`, `player_items`.
- **Backend:** Hasar = lazer hasarı × mermi çarpanı × yükseltme × yetenek; tamamen sunucuda hesaplanır.
- **Güvenlik:** Atış hızı, menzil ve mermi stoğu sunucuda kontrol edilir; istemci yalnızca "ateş et" niyeti gönderir.
- **Türk Orbit kararı:** 4 lazer kademesi, 4 normal + 2 özel mermi ile başlangıç.

### 3.7 Kalkanlar ve jeneratörler — Aşama 6
- **İşleyiş [K/G]:** Jeneratör slotlarına kalkan veya hız jeneratörü takılır (hız ↔ dayanıklılık dengesi).
- **Veritabanı / Backend:** `item_types (shield_generator, speed_generator)`. Kalkan emme oranı hasar formülünde.
- **Güvenlik:** Hız sınırı sunucudaki hareket doğrulamasının temelidir.
- **Türk Orbit kararı:** "Siper" kalkan ve "İtki" hız jeneratörü serileri.

### 3.8 Drone ve PET — Aşama 6/9
- **İşleyiş [K]:** Drone'lar ek lazer/kalkan slotu sağlar ve seviye atlar. Tasarım setleri bonus verir. PET bağımsız modüllerle çalışır (toplama, tamir, koruma), kendini tamir edemez.
- **Arayüz:** Drone formasyon ekranı, PET modül slotları, PET yakıt göstergesi.
- **Veritabanı:** `player_drones, player_pets, player_pet_modules`.
- **Backend:** PET yapay zekâsı oyun sunucusunda çalışır (otomatik kargo toplama gibi), istemcide değil.
- **Güvenlik:** PET'in toplama menzili ve hızı sunucu sınırlarına tabidir (bot benzeri avantaj sınırlanır).
- **Türk Orbit kararı:** Drone'lar "Arı/Yaban/Alkım", PET'in adı "Yoldaş".

### 3.9 Envanter — Aşama 6
- **İşleyiş [G]:** Eşya örnekleri, yığınlanabilir eşyalar, kargo kapasitesi.
- **Veritabanı:** `player_items` (örnek bazlı) + `item_ledger` (yalnızca eklenebilir hareket defteri).
- **Backend:** Her eşya hareketinin bir `idempotency_key`'i var: aynı ödül iki kez yazılamaz.
- **Güvenlik:** Envanter manipülasyonuna karşı her değişiklik sunucu servisinden geçer ve deftere yazılır.

### 3.10 Geliştirme ve yükseltme — Aşama 6/11
- **İşleyiş [G]:** Ekipman seviye yükseltme (başarı şansı, kaynak maliyeti).
- **Veritabanı:** `upgrade_levels` (çarpan, şans, maliyet).
- **Backend:** Rastgelelik sunucuda (kriptografik RNG). Sonuç ve maliyet tek transaction'da işlenir.
- **Güvenlik:** İstemci şans sonucunu belirleyemez; aynı isteğin tekrarı idempotent.

### 3.11 Pilot yetenekleri — Aşama 9
- **İşleyiş [K]:** Pilot puanıyla açılan yetenek ağacı.
- **Veritabanı:** `skill_nodes, player_skills`.
- **Backend:** Yetenek etkileri gemi istatistiklerine sunucuda uygulanır.
- **Türk Orbit kararı:** 4 dal (Savaş, Savunma, Ekonomi, Keşif); sıfırlama ücretli/sınırlı.

### 3.12 NPC ve düşman yapay zekâsı — Aşama 9
- **İşleyiş [K/G]:** Devriye, algılama menzili, saldırgan/pasif davranış, boss NPC'ler, yeniden doğma.
- **Veritabanı:** `npc_types, npc_spawns` (haritaya özel değişiklikler `overrides` ile).
- **Backend:** Durum makinesi (Devriye → Takip → Saldırı → Kaçış → Ölüm). Hedef seçimi tehdit tablosuyla yapılır.
- **Güvenlik:** NPC ödülü yalnızca sunucunun hasar kaydına göre dağıtılır (en çok hasar / katkı oranı).
- **Türk Orbit kararı:** NPC aileleri (Çakal, Akrep, Örümcek, Yarasa, Kırkayak, Tepegöz…) farklı harita ve kapılarda yeniden kullanılır.

### 3.13 Galaxy Gate (Yıldız Kapısı) — Aşama 9
- **İşleyiş [K]:** Parça topla → kapıyı inşa et → dalgaları bitir → büyük ödül; can hakkı sınırlı.
- **Veritabanı:** `gates, gate_waves (composition: mevcut NPC türleri + çarpanlar), player_gates`.
- **Backend:** Kapı haritası kişiye/gruba özel örnek (instance) olarak açılır.
- **Güvenlik:** Parça kazanımı defterlidir; dalga ilerlemesi sunucuda tutulur.
- **Türk Orbit kararı:** Ergenekon, Ötüken, Umay, Tengri, Kayra, Erlik ve Kızılelma kapıları (özgün adlar).

### 3.14 Ana görevler — Aşama 10
- **İşleyiş [G]:** Seviyeye göre açılan hikâye/eğitim zinciri.
- **Veritabanı:** `quests (category='main', prerequisite_quest_id, chain_code), quest_objectives, player_quests`.
- **Backend:** Görev ilerlemesi oyun sunucusu olaylarından beslenir (öldürme, toplama, harita ziyareti).

### 3.15 Günlük görevler — Aşama 10
- **İşleyiş [K]:** Her gün sıfırlanan, havuzdan rastgele seçilen görevler; sınırlı yeniden çekme hakkı.
- **Türk Orbit kararı:** Günlükler kısa sürer (15–30 dk). Gün sıfırlaması 05:00 TSİ'de yapılır. `cycle_key` ile her gün ayrı kayıt tutulur.

### 3.16 Haftalık görevler — Aşama 10
- Daha yüksek hedefler; `cycle_key='2026-W48'` biçimi. Sıfırlama pazartesi 05:00 TSİ.

### 3.17 Etkinlik görevleri — Aşama 10
- Başlangıç/bitiş tarihli; etkinlik haritası ve özel NPC'lerle bağlantılı. Yönetim Merkezi'nden yayımlanır.
- **Toplam hedef:** ~300 görev (≈120 ana, 90 günlük, 60 haftalık, 30 etkinlik). Liste Aşama 10'da Türk Orbit NPC/harita adlarıyla yazılacak.

### 3.18 Ekonomi ve mağaza — Aşama 11
- **İşleyiş [K]:** Kolay ve değerli olmak üzere iki para birimi, kaynaklar, mağaza, indirimler, paketler.
- **Veritabanı:** `currencies, wallets (balance >= 0 kısıtı), currency_ledger, shop_categories, shop_offers, crafting_recipes, daily_login_rewards`.
- **Backend:** Bakiye değişikliği = `SELECT … FOR UPDATE` + defter kaydı + `idempotency_key` (çift harcama engeli).
- **Güvenlik:** Fiyat her zaman sunucudaki teklif kaydından okunur, istemciden gelen fiyat yok sayılır.

### 3.19 Açık artırma — Aşama 11
- **İşleyiş [B]:** Saatlik/günlük/haftalık açık artırmalar (aramalarda doğrulanamadı; tür genelinde yaygın).
- **Veritabanı:** `auctions, auction_bids`.
- **Backend:** Teklif verildiğinde tutar emanete alınır, geçilen teklif otomatik iade edilir; kapanışı worker yapar.
- **Güvenlik:** Teklif yarışları satır kilidiyle çözülür; son saniye uzatması (anti-sniping) eklenebilir.

### 3.20 Klan ve grup — Aşama 12
- **İşleyiş [K]:** Klan katılımı, rütbeler, klan vergisi/hazinesi, diplomasi (ittifak, saldırmazlık, savaş).
- **Veritabanı:** `clans, clan_ranks, clan_members, clan_applications, clan_diplomacy, clan_treasury_ledger`.
- **Backend:** Grup (party) canlı durumu Redis'tedir; grup üyelerinin harita/konum bilgisi izinlere göre paylaşılır.
- **Güvenlik:** Rütbe yetkileri sunucuda denetlenir; hazine hareketleri deftere yazılır.

### 3.21 Sohbet ve arkadaşlık — Aşama 12
- **Kanallar:** genel, şirket, harita, klan, grup, özel mesaj.
- **Veritabanı:** `chat_messages, friendships, player_blocks, reports`.
- **Backend:** Redis pub/sub ile sunucular arası iletim; mesaj başına hız sınırı; küfür filtresi.
- **Güvenlik:** Engellenen oyuncunun mesajları iletilmez; şikâyet edilen mesaj moderasyon kuyruğuna düşer.

### 3.22 Etkinlik ve sıralama — Aşama 12/14
- **Veritabanı:** `events, leaderboard_snapshots`. Canlı sıralama Redis sıralı kümelerinde tutulur, periyodik olarak anlık görüntü alınır.

### 3.23 Forum ve destek — Aşama 13
- **Forum:** Oyun hesabıyla ortak giriş. Bölümler, sabitleme, kilitleme, beğeni, takip, tam metin arama (`tsvector`), raporlama.
- **Destek:** `TO-2026-000123` biçiminde benzersiz talep numarası, ek dosyalar (nesne depolama), durum akışı, personel iç notları.

### 3.24 Yönetim ve moderasyon — Aşama 14
- RBAC (8 personel rolü), yaptırım geçmişi (`sanctions`), hile olayları (`anticheat_events`), içerik sürümleme ve geri alma (`content_revisions`), iki yetkili onayı (`approval_requests`), değiştirilemez denetim kaydı (`admin_audit_log`).
- Ayrıntı: [05-Yonetim-Merkezi-Plani.md](05-Yonetim-Merkezi-Plani.md).

## 4. Belirsizlik listesi (doğrulanması gerekenler)

| # | Konu | Durum | Türk Orbit'e etkisi |
|---|---|---|---|
| 1 | Harita açılış seviyeleri | Kaynaklar çelişkili [B] | Yok: Türk Orbit kendi seviye tablosunu kullanır |
| 2 | Açık artırma takvimi | Doğrulanamadı [B] | Yok: saatlik/günlük/haftalık türleri tasarlandı, süreler yönetimden ayarlanır |
| 3 | Konfigürasyon 1/2 ayrıntıları | Doğrulanamadı [G] | Yok: istekte zaten 2 konfigürasyon şartı var |
| 4 | Güncel kapı sayısı ve parça sayıları | 2019 tarihli kaynak [B] | Yok: 7 özgün kapı tasarlandı |
| 5 | Türkçe forumdaki yerel kurallar/etkinlikler | Erişilemedi | Topluluk kuralları Aşama 13'te sıfırdan yazılacak |
| 6 | Sezon bileti güncel ayrıntıları | Kaynak Şubat 2026 tarihli | Sezon bileti Türk Orbit için isteğe bağlı gelecek özelliktir |

## 5. Arama özeti kaynakları

- board-en.darkorbit.com/posts/979327 — FAQ: Season Pass
- board-en.darkorbit.com/threads/beginners-guide-to-skylab.1210/
- board-en.darkorbit.com/goto/post?id=824376 — Stats and tactics for PvP
- darkorbitwiki.com/guides/beginners-how-to-start/ · /?p=764 (Galaxy Gates) · /?p=1323 (Lasers and Ammunition) · /equipment/tech-items/ · /p-e-t · /guides/ranks/
- darkorbit.fandom.com/wiki/Boss_NPC · /wiki/3-8 · /wiki/File:Galaxy_Gate_Alpha.png
- wikipedia.org/wiki/DarkOrbit
- store.steampowered.com/app/4054110/DarkOrbit_Reloaded/

*(Bu adreslerin içeriği bu oturumda doğrudan açılamadı; yalnızca arama motoru özetleri kullanıldı.)*
