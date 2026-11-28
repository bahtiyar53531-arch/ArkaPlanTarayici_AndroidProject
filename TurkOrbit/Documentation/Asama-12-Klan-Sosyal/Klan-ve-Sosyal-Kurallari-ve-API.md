# Aşama 12 — Klan ve Sosyal: Kurallar, Protokol ve API

**Kurallar:** `packages/shared/src/social.ts` · **Servisler:** `apps/api/src/modules/social/{clan,service,notifications,treasury,party}.ts`
**Oyun sunucusu:** `apps/api/src/game/server.ts` (sohbet, grup, saldırı ilişkisi) · **Veri:** `database/migrations/0008_social.sql`

> **İlkeler:**
> - Yetki, izin, hız sınırı, küfür filtresi ve engelleme **sunucuda** uygulanır. Arayüz yetkileri yalnızca düğmeleri göstermek için okur; yetkisiz istek `CLAN_PERMISSION` (403) ile döner.
> - Para hareketleri (klan kurma, hazine, vergi) mevcut cüzdan çekirdeğinden geçer: satır kilidi, negatif bakiye imkânsız, idempotent defter.
> - Bildirim transaction içinde yazılır; anlık iletim işlem **bittikten sonra** yapılır (geri alınan işlemin bildirimi gitmez).
> - "Engellenmiş olmak" ile "isteğe kapalı olmak" aynı mesajla bildirilir: kimin kimi engellediği sızmaz.

## 1. Klan

| Kural | Değer (`game_settings.clan`) |
|---|---|
| Kuruluş ücreti | 50.000 Kredi (`create_cost`), defter gerekçesi `clan_create` |
| Kuruluş seviyesi | en az 5 (`create_min_level`) |
| Üye sınırı | 50 (`max_members`) |
| Davet süresi | 7 gün (`invitation_days`) |
| Diplomatik ilişki sınırı | 10 (`max_relations`) |

- **Etiket:** 2–5 karakter, harf/rakam (Türkçe büyük harfler dahil), Türkçe kurala göre büyük harfe çevrilir (`çğı` → `ÇĞI`). Sunucu başına benzersiz, büyük/küçük harf duyarsız.
- **Ad:** 3–30 karakter, birden çok boşluk teke iner. Etiket ve ad sohbet filtresinin yasaklı kelimelerinden geçer.
- **Tek klan:** Bir pilot aynı anda yalnızca bir klanda olabilir (`clan_members.player_id` UNIQUE).
- **Katılım yolları:**
  - Başvuru: üye alan klana, seviye şartını sağlayan pilot başvurur. Aynı anda en fazla 5 bekleyen başvuru olabilir.
  - Davet: "Üye alma" yetkisi olan üye davet eder; pilot kabul eder.
  - Bekleyen bir davet varken başvuru doğrudan katılım olur; bekleyen başvuru varken davet de öyle.
  - Katılınca diğer bekleyen başvuru ve davetler iptal edilir.
- **Eşzamanlılık:** Katılım klan satırını kilitler (`FOR UPDATE`). Aynı anda gelen kabullerde üye sınırı aşılamaz (testli: sınır 4, 7 eşzamanlı istek → tam 4 üye).

### Rütbeler ve yetkiler
| Rütbe | Sıra | Varsayılan yetkiler |
|---|---|---|
| Lider | 0 | Tümü (değiştirilemez) |
| Komutan | 1 | Üye alma, çıkarma, rütbe verme, diplomasi, hazineden ödeme, bilgi düzenleme |
| Subay | 2 | Üye alma ve davet |
| Üye | 3 | — |

- Yetkiler: `invite`, `kick`, `promote`, `diplomacy`, `treasury`, `edit_info`.
- Rütbe adlarını ve yetkilerini yalnızca lider düzenler.
- **Yalnızca alt rütbe yönetilir:** Çıkarma ve rütbe vermede hedef üyenin rütbesi, verilen rütbe de işlemi yapanın rütbesinin altında olmalı. Lider asla yönetilemez.
- **Liderlik:** Devredilir; eski lider ikinci rütbeye geçer.
  - Lider, klanda başka üye varken ayrılamaz.
  - Tek başınaysa ayrılmak klanı dağıtır.
- **Dağıtma (yalnızca lider):**
  - Hazinedeki Kredi lidere iade edilir; oyuncu defterine `clan_disband` yazılır.
  - Üyeler bildirim alır, diplomasi ilişkileri biter, klan silinir.
- **Vergi:** %0–5, yalnızca lider ayarlar.
  - Üyenin NPC'den kazandığı **Kredi** ödülünün bu yüzdesi aynı transaction'da hazineye aktarılır.
  - Oyuncu defterine `clan_tax`, hazine defterine `clan_tax` yazılır.
  - Ödül bildiriminde "klan vergisi −X Kredi" görünür.

### Hazine
- Her üye Kredi yatırabilir (`clan_deposit`). "Hazineden ödeme" yetkisi olan, yalnızca klan üyelerine ödeme yapabilir (`clan_payout`).
- `clan_treasury_ledger` yalnızca eklenebilir; güncelleme veritabanı tetikleyicisiyle reddedilir.
- Her hareket `requestId` ile idempotenttir: aynı istek iki kez uygulanmaz.
- Hazine yetersizse işlemin tamamı geri alınır; oyuncuya da ödeme yapılmaz.
- **Kilit sırası:** önce pilot satırı/cüzdanı, en son klan cüzdanı. Birden çok pilotlu NPC ödülünde klan cüzdanları klan kimliği sırasıyla kilitlenir. Böylece kilitlenme (deadlock) oluşmaz.

### Diplomasi
| İlişki | Nasıl kurulur | Nasıl biter | Oyunda etkisi |
|---|---|---|---|
| İttifak | Öneri → karşı klan onaylar | Taraflardan biri bitirir | Pilotlar birbirine saldıramaz |
| Saldırmazlık | Öneri → karşı klan onaylar | Taraflardan biri bitirir | Pilotlar birbirine saldıramaz |
| Savaş | Tek taraflı ilan (hemen etkin) | İki taraf da barış önerince | Aynı şirketten olsalar bile PvP haritalarında birbirine saldırabilirler |

- İttifak veya saldırmazlık varken savaş ilan edilemez; önce anlaşmanın bitirilmesi gerekir.
- Karşı taraf aynı öneriyi zaten yaptıysa öneri kabul sayılır.
- Diplomasi işlemi iki klan satırını kimlik sırasıyla kilitler. Yetki, kilitten sonra yeniden okunur.
- **Oyun sunucusuna yansıma:** API, Redis `game:relations` kanalına yayın yapar. Oyun sunucuları etkin ilişkileri yeniden okur ve ilgili pilotlara `{t:'social'}` gönderir. Saldırı kuralı anında değişir (testli).

### Saldırı kuralı (`canAttack`, ortak)
Sıra:
1. Kargo kutusuna saldırılamaz.
2. Saldıran ve hedef güvenli bölgede olmamalı.
3. Harita PvP'ye açık olmalı.
4. Pilotlar arası ilişkiye bakılır:
   - grup → "Grup arkadaşına saldıramazsın."
   - klan → "Kendi klanından pilota saldıramazsın."
   - ittifak → "Müttefik klandan pilota saldıramazsın."
   - saldırmazlık → "Saldırmazlık anlaşması olan klandan pilota saldıramazsın."
   - **savaş → izin verilir** (şirket kuralı atlanır).
5. İlişki yoksa aynı şirketten pilota saldırılamaz.

## 2. Arkadaşlık, engelleme, gizlilik
- **Arkadaşlık:**
  - İstek gönderilir, karşı taraf kabul edince iki yönlü kayıt oluşur.
  - Karşılıklı istek otomatik kabul edilir.
  - Arkadaş sınırı 200'dür (`game_settings.social.max_friends`).
- **Arkadaş listesi:** Çevrimiçi durum ve bulunulan harita, **arkadaşın kendi** "çevrimiçi görünürlüğü" ayarına göre gösterilir. Gizleyen arkadaş için `online: null` döner.
- **Engelleme:** En fazla 500 pilot engellenebilir. Engellemenin etkileri:
  - Arkadaşlık ve istekler silinir.
  - Engellenen pilotun sohbet mesajları (canlı ve geçmiş, tüm kanallar) engelleyene iletilmez.
  - Engellenen pilot özel mesaj, arkadaşlık isteği, grup veya klan daveti gönderemez.
  - Oyun sunucusu engel listesini canlı olarak yeniden okur (`game:player-updated`, sebep `social`).
- **Gizlilik ayarları** (`player_social_settings`):

| Ayar | Seçenekler | Varsayılan |
|---|---|---|
| Grup üyeleri konumumu | harita ve konum / yalnızca harita adı / gizli | harita ve konum |
| Arkadaşlar çevrimiçi olduğumu görsün | evet / hayır | evet |
| Özel mesaj | herkes / yalnızca arkadaşlar / kimse | herkes |
| Grup daveti | herkes / arkadaşlar ve klanım / kimse | herkes |
| Arkadaşlık isteği alabileyim | evet / hayır | evet |

## 3. Grup (party) — oyun sunucusu + Redis
- **Boyut ve davet:** En fazla 8 pilot (`social.party_max`). Davet 60 sn geçerlidir.
  - Davet edilenin çevrimiçi olması ve davet iznini sağlaması gerekir.
  - Grubu varsa yalnızca lider davet eder.
- **Canlı durum Redis'tedir** (`party:*` anahtarları, 180 sn TTL; oyundaki üyelerin süreci her saniye yeniler).
  - Katılma, ayrılma, çıkarma ve lider değişimi tek bir Lua betiğiyle **atomiktir**.
  - Eşzamanlı kabullerde sınır aşılamaz (testli: 10 kabul → 8 üye, 3 "Grup dolu").
  - Bir pilot aynı anda iki grupta olamaz.
- **Lider ve dağılma:**
  - Lider ayrılırsa en eski üye lider olur.
  - Grupta tek kişi kalırsa grup dağılır ve kalan pilota bildirilir.
  - Oyundan tamamen çıkan pilot gruptan ayrılır; bağlantısı kısa süre kopan pilot bekleme süresinde grupta kalır.
- **Grup paneli:** Her saniye güncellenir. Her üye için ad, seviye, şirket, liderlik, çevrimiçi durum ve can/kalkan yüzdesi gösterilir.
  - **Konum, ÜYENİN kendi iznine göre gösterilir:**
    - "harita ve konum": harita ve koordinat
    - "yalnızca harita": harita adı
    - "gizli": hiçbiri
  - Aynı haritadaki üyenin varlık kimliği de verilir; mini haritada yeşil halka olarak çizilir.
- **Kabul ölçütü (07):** "Grup üyesinin farklı haritadaki konumu izinlere göre görünür." Entegrasyon testi, API E2E ve tarayıcı E2E ile doğrulandı.
- **Grup içi koruma:** Grup üyeleri birbirine saldıramaz.

## 4. Sohbet — oyun sunucusu WebSocket'i
| Kanal | Kimlere gider | Saklanan kanal adı |
|---|---|---|
| Genel | Aynı sunucudaki herkes | `global` |
| Şirket | Aynı şirket | `company:<KOD>` |
| Harita | Aynı harita | `map:<KOD>` |
| Klan | Klan üyeleri | `clan:<uuid>` |
| Grup | Grup üyeleri | `group:<id>` |
| Özel | Yalnızca iki taraf | `dm:<küçük uuid>:<büyük uuid>` |

- **Akış:** İstemci `{t:'chat', ch, b, to?}` gönderir. Sunucu sırasıyla:
  1. Susturma kontrolü
  2. Hız sınırı
  3. Temizlik (görünmez karakterler, boşluklar)
  4. Uzunluk kontrolü (≤ 300)
  5. Kanal ve izin kontrolü
  6. Küfür filtresi
  7. Veritabanı kaydı (`chat_messages`)
  8. Redis `game:chat` yayını

  Her süreç mesajı kanala uyan yerel pilotlara iletir. Gönderen alıcı tarafından engellenmişse mesaj o alıcıya **iletilmez**.
- **Hız sınırı:** 10 sn içinde en fazla 5 mesaj. Aşılınca 60 sn susturma uygulanır (`game_settings.chat`). Aynı pilotun mesajları sırayla işlenir.
- **Küfür filtresi:** `game_settings.chat.banned_words`. Mesaj reddedilmez, kelime yıldızlanır.
  - Yakalanan yazımlar: büyük/küçük harf, Türkçe harfler (İ/ı/ş…), benzer rakamlar (`s1kt1r`) ve harf tekrarı (`siiiktir`).
  - Kısa kökler yalnızca tam kelime olarak yakalanır ("aqua", "sikke" maskelenmez). 5+ harfli kökler kelime başında yakalanır.
  - Kayıtta `filtered = true` işaretlenir.
- **Özel mesaj kuralları:**
  - Alıcı bulunmalı ve kendin olmamalı.
  - Alıcıyı engellediysen önce engeli kaldırmalısın.
  - Alıcı seni engellediyse veya özel mesaja kapalıysa (ya da "yalnızca arkadaşlar" seçip arkadaş değilseniz) "… şu an senden özel mesaj kabul etmiyor."
- **Geçmiş (REST):** `GET /chat/history?channel=global|company|clan|dm&with=<pilot>&before=<id>` son 50 mesajı döndürür; engellenenlerin mesajları çıkarılır.
  - Harita ve grup kanalları yalnızca canlıdır; kayıtları moderasyon için tutulur.
  - `GET /chat/conversations` özel mesajlaşılan pilotları listeler.

## 5. Bildirimler
| Tür | Ne zaman |
|---|---|
| `friend_request`, `friend_accepted` | Arkadaşlık isteği / kabul |
| `clan_application`, `clan_application_result` | Başvuru (yetkililere) / sonuç (başvurana) |
| `clan_invitation`, `clan_joined` | Davet / davetin kabulü |
| `clan_kicked`, `clan_rank`, `clan_payout`, `clan_disbanded` | Klan işlemleri |
| `clan_diplomacy`, `clan_war` | Öneri, kabul, red, bitiş (yetkililere) / savaş ilanı (tüm üyelere) |
| `auction_outbid`, `auction_won` | Açık artırmada teklif geçildi / kazanıldı (**Aşama 11'deki sınırlama giderildi**) |

- **Web:** Menüdeki 🔔 zili okunmamış sayısını 30 sn'de bir sorar. Açılınca son 30 bildirim listelenir ve okundu işaretlenir.
- **Oyun:** Pilot oyundaysa bildirim Redis `game:deliver` kanalıyla anında iletilir (`{t:'notif'}`) ve bildirim olarak gösterilir.
- **Saklama:** Pilot başına en yeni 200 bildirim tutulur (okundu işaretlenince eskiler silinir).

## 6. Şikâyet (moderasyon kuyruğu)
- **Gönderim:** `POST /reports {targetType: chat_message|player|clan, target, reason, details?}` → 201.
  - Sebepler: spam, hakaret/küfür, hile şüphesi, uygunsuz ad, dolandırıcılık, diğer.
- **Kanıt:** Şikâyet anındaki içerik `snapshot` alanına kopyalanır (mesaj metni, gönderen, kanal). İçerik sonradan değişse de kanıt korunur.
- **Kısıtlar:**
  - Kendi mesajın veya kendin şikâyet edilemez.
  - Özel mesajı yalnızca taraflar şikâyet edebilir.
  - Aynı içerik için açık şikâyet varken tekrar şikâyet edilemez (`REPORT_EXISTS`).
  - Saatte en fazla 10 şikâyet.
- **Kuyruk:** Kayıtlar `reports` tablosunda `open` durumunda bekler. **Yönetim ekranı Aşama 14'te gelecek**; o zamana kadar kuyruk SQL ile görülür. Oyuncuya gösterilen mesaj bunu doğru anlatır: "Şikâyetin kaydedildi; moderasyon ekibi inceleyecek."

## 7. Protokol eklemeleri (sürüm 2, geriye uyumlu)
- **İstemci → sunucu:**
  - `{t:'chat', ch, b, to?}`
  - `{t:'party', a: invite|accept|decline|leave|kick|promote, n?}`
- **Sunucu → istemci:**
  - `{t:'chat', m}`
  - `{t:'party', p: PartyView|null}` (değiştiğinde)
  - `{t:'pinv', from, level, company, expiresIn}`
  - `{t:'notif', n}`
  - `{t:'social'}`
- **Varlık bilgisi:** `EntityInfo.ct` (klan etiketi). Etiket değişince çevredeki pilotlara pilot bilgisi yeniden gönderilir. Gemi adı `[AKN] Ad · Sv 5` olarak çizilir.
- **Ödül mesajı:** `clanTax?`.
- **Redis kanalları:**
  - `game:chat`
  - `game:deliver` (pilot hangi süreçteyse oradaki bağlantısına mesaj)
  - `game:relations`
  - `game:player-updated` (yeni sebep: `social`)

## 8. REST uçları (`/api/v1`)
| Uç | Açıklama |
|---|---|
| `GET /clan?server=` | Klanın (veya klansızsan davetler, başvurular, kuruluş şartı) |
| `GET /clans?server=&q=` · `GET /clans/:server/:tag` | Klan arama · açık klan sayfası (oturumsuz) |
| `POST /clan/create` | `{tag, name, description?, requestId}` |
| `POST /clan/update` | `{description?, isRecruiting?, minLevel?, taxPercent?}` |
| `POST /clan/apply` · `/clan/applications/withdraw` · `/clan/applications/decide` | Başvuru akışı |
| `POST /clan/invite` · `/clan/invitations/cancel` · `/clan/invitations/respond` | Davet akışı |
| `POST /clan/leave` · `/clan/kick` · `/clan/members/rank` · `/clan/ranks/update` · `/clan/transfer` · `/clan/disband` | Üyelik ve rütbeler |
| `POST /clan/treasury/deposit` · `/clan/treasury/withdraw` | Hazine (`requestId` zorunlu) |
| `POST /clan/diplomacy/propose` · `/respond` · `/war` · `/end` | Diplomasi |
| `GET /social/friends` · `POST /social/friends/request` · `/respond` · `/remove` | Arkadaşlık |
| `POST /social/block` · `/social/unblock` · `PUT /social/settings` · `GET /social/relation?name=` | Engelleme, gizlilik, profil ilişkisi |
| `GET /notifications` · `GET /notifications/unread` · `POST /notifications/read` | Bildirimler |
| `POST /reports` | Şikâyet |
| `GET /chat/history` · `GET /chat/conversations` | Sohbet geçmişi |

**Hız sınırları (kullanıcı başına):**

| İşlem | Sınır |
|---|---|
| Klan kurma | 5/saat |
| Başvuru | 20/saat |
| Davet | 60/saat |
| Diplomasi | 30/saat |
| Arkadaşlık isteği | 30/saat |
| Engelleme | 60/saat |
| Şikâyet | 10/saat |
| Sohbet geçmişi | 120/dk |

Klan listesi ve açık klan sayfası IP başına 120/dk ile sınırlıdır.

**Yeni hata kodları:** `CLAN_NOT_FOUND`, `CLAN_EXISTS`, `ALREADY_IN_CLAN`, `NOT_IN_CLAN`, `CLAN_FULL`, `CLAN_PERMISSION`, `CLAN_NOT_RECRUITING`, `APPLICATION_EXISTS`, `INVITATION_NOT_FOUND`, `DIPLOMACY_EXISTS`, `DIPLOMACY_NOT_FOUND`, `FRIEND_EXISTS`, `FRIEND_LIMIT`, `BLOCKED`, `NOT_ALLOWED`, `REPORT_EXISTS`.

## 9. Arayüz
- **Oyun (masaüstü):**
  - Sol altta açılır-kapanır sohbet: 7 sekme (Tümü + 6 kanal). Enter sohbete geçer; yazarken oyun kısayolları devre dışı kalır.
  - Ada tıklayınca menü açılır: Özel mesaj · Gruba davet et · Profili aç · Engelle · Şikâyet et.
  - Sol üstte grup paneli, ortada grup daveti kartı (Kabul/Reddet, geri sayım).
  - Hedef panelinde pilot için "Gruba davet et" ve "Özel mesaj" düğmeleri.
  - Gemi adlarında klan etiketi.
- **Oyun (telefon/tablet):** Üst çubukta 💬 (okunmamış sayısıyla). Tam ekran çekmecede grup paneli ve sohbet.
- **Web sayfaları:**
  - `/klan`: klan arama, başvuru, kurma; klandaysan Genel · Üyeler · Başvurular · Hazine · Diplomasi · Rütbeler · Kayıtlar.
  - `/klan/:sunucu/:etiket`: açık klan sayfası.
  - `/sosyal`: Arkadaşlar · İstekler · Engellenenler · Gizlilik.
  - Menüde 🔔 zili.
  - Açık pilot profilinde klan bağlantısı ve "Arkadaş ekle / Engelle / Şikâyet et".
