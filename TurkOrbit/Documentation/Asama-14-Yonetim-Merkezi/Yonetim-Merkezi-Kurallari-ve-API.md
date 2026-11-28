# Aşama 14 — TÜRK ORBIT YÖNETİM MERKEZİ: Kurallar ve API

**Uygulama:** `apps/admin` (üretimde `https://turkorbit.com/yonetim/`)
**API:** `/api/v1/admin/*` — `apps/api/src/modules/admin/`
**Ortak kurallar:** `packages/shared/src/admin.ts`
**Veri:** `database/migrations/0010_admin.sql`

## İlkeler
- **Hesap:** Panel ayrı bir uygulamadır ama ayrı bir hesap sistemi yoktur. Oyuncu hesabıyla aynı oturum kullanılır; yetkiler veritabanındaki rol–yetki eşlemesinden gelir. Personel olmayan hesap panele girince yalnızca "Yetkin yok" görür, API de 403 döner.
- **Yetki denetimi:** Yalnızca sunucuda yapılır. Menü, `/auth/me` yanıtındaki yetkilere göre öğe gizler; bu sadece kolaylıktır. Her uç nokta oturum + yetki ister. Servisler işlemin ayrıntısına göre ikinci kez denetler: hedefin rütbesi, onaylayanın yetkisi, yayın için türün yazma yetkisi.
- **Denetim kaydı:** Her değişiklik `admin_audit_log`'a yazılır: yönetici, işlem, hedef, önceki/sonraki değer, gerekçe, sonuç, IP. Kayıt işlemle aynı transaction'dadır, değiştirilemez ve silinemez.
- **Altın kural:** Panelde değişen her değer gerçek oyuna yansır. Backend'i olmayan özellik menüde **gösterilmez** (K-101).

## 1. Yetki koruması ve 403 testi
Tüm uçlar `apps/api/src/modules/admin/routes.ts` içindeki **`ADMIN_ROUTE_SPECS`** tablosundadır: yöntem, adres ve gereken yetki.
- Rota kaydı bu tablodan yapılır. Tabloda olup işleyicisi olmayan (veya tersi) uç sunucuyu başlatmaz.
- `apps/api/test/admin.test.ts` tablodaki **her uç** için üç durumu dener: oturumsuz → 401, oyuncu → 403, o yetkiye sahip olmayan bir personel rolü → 403.

## 2. Modüller
| Modül | Menü | Yetki | Ne yapar |
|---|---|---|---|
| Pano | Pano | `dashboard.view` | Toplam/bugün/7 gün kayıt, pilot, çevrimiçi, harita başına pilot, oyun sunucusu süreçleri (bağlantı, pilot, oda, NPC, tik süresi, bellek), API/PostgreSQL/Redis gecikmesi, platform başına oturum, açık talep/şikâyet, bekleyen onay, son işlemler (`audit.read`). 10 sn'de bir yenilenir |
| Onaylar | Onay bekleyenler | `dashboard.view` + işlemin yetkisi | İki yetkili onayı (§5) |
| Oyuncu yönetimi | Oyuncular | `players.read` + işleme göre | Arama, ayrıntı, yaptırımlar, oturum kapatma, rol atama (§3) |
| Şikâyetler | Şikâyetler | `chat.reports.read` / `chat.moderate` | Kuyruk (açık, inceleniyor, işlem yapıldı, reddedildi), içerik kopyası, karar. Şikâyetten verilen yaptırım şikâyete bağlanır |
| Para / eşya ver | Ekonomi | `economy.grant` | Gerekçeli verme; eşik üstü onaya gider (§5) |
| Klanlar | Klanlar | `clans.read` | Liste, üyeler, hazine, etkinlikler (salt okunur) |
| İçerik | NPC, gemi, mağaza, görev, harita | türe göre (§4) | Taslak → fark → yayın → geri alma; yeni etkinlik görevi |
| Forum | Forum yönetimi | `forum.read`, `forum.categories.write`, `forum.moderators.assign` | Bölüm ekle/düzenle/arşivle, konu açma yetkisi, bölüm moderatörü atama. Konu moderasyonu forumun kendisinde |
| Destek masası | Destek masası ↗ | `support.read` | Aşama 13'teki destek masasına (ana sitede) bağlantı |
| Sistem | Sunucular ve bakım | `system.read`, `system.maintenance`, `system.notifications` | Süreç durumu, bakım modu (§6), oyun içi duyuru |
| Oyun ayarları | Oyun ayarları | `settings.read/write` | 14 ayar grubu, sürümlü (§4) |
| Roller | Roller ve yetkiler | `roles.read` | Rol–yetki matrisi (veritabanından), rol üyeleri |
| Denetim kaydı | Denetim kaydı | `audit.read` | Yönetici, işlem öneki ve hedefe göre süzme; önce/sonra değerleri; sayfalama |

## 3. Oyuncu yönetimi ve yaptırımlar
- **Arama:** kullanıcı adı, e-posta, pilot adı (önek), oyuncu ID, kullanıcı veya pilot kimliği, IP (giriş geçmişi ve oturumlarda).
- **Ayrıntı:** hesap durumu, roller, pilotlar (şirket, seviye, XP, şeref, harita, çevrimiçi, klan, gemi, cüzdanlar, eşya ve görev sayısı), yaptırım geçmişi, açık oturumlar, son 20 giriş.

| İşlem | Yetki | Etki |
|---|---|---|
| Uyar | `players.warn` | Kayıt + oyuncuya bildirim |
| Sustur (1 sa – 30 gün) | `chat.moderate` | Oyun sohbeti ve forum yazmayı keser; oyun sunucusu anında öğrenir |
| Askıya al (geçici ban) | `players.ban` | Hesap askıda. Tüm oturumlar ve oturum önbelleği temizlenir; oyundaki bağlantı gerekçeli mesajla **anında** kapanır. Girişte gerekçe görünür |
| Kalıcı ban | `players.ban` | **İki yetkili onayı** sonrası uygulanır |
| Kilitle | `players.lock` | Güvenlik kilidi + oturumlar düşer |
| Susturmayı / banı / kilidi kaldır | `chat.moderate` / `players.unban` / `players.lock` | Kayıt "kaldırıldı" olur, gerekçe yazılır |
| Oturumları kapat | `players.sessions.revoke` | Tüm oturumlar + oyundan atma |
| Rol ekle/kaldır | `roles.assign` | Rütbe kuralı; Süper Yönetici ataması onaylı |

- **Gerekçe:** Her işlem gerekçe ister (en az 3 karakter). Oyuncuya gösterilecek açıklama isteğe bağlıdır.
- **Rütbe kuralı (K-096):**
  - Kendine işlem yapılamaz.
  - Kendinle eşit veya üst rütbeye işlem yapılamaz (ör. moderatör oyun yöneticisini askıya alamaz).
  - Kendi rütbene eşit veya yüksek bir rol atanamaz.
  - Son Süper Yönetici kaldırılamaz.

## 4. İçerik sürümleme (yayınla / geri al)
| Tür | Okuma / yazma | Yayın / geri alma | Düzenlenebilir alanlar | Oyuna yansıma |
|---|---|---|---|---|
| NPC türleri | `npcs.read/write` | `content.publish` / `content.rollback` | ad, can, kalkan, emme oranı, hasar, atış aralığı, menzil, hız, deneyim, şeref | **Canlı:** yeni doğan yeni değerle, yaşayanlar can/kalkan oranı korunarak ölçeklenir; oyuncu yeni adı ve azami canı hedef panelinde görür |
| Gemiler | `ships.read/write` | aynı | ad, açıklama, taban can, hız, ambar, seviye, satışta | Bu gemiyi kullanan çevrimiçi pilotların değerleri anında yeniden hesaplanır |
| Mağaza | `economy.read/write` | aynı | fiyat, indirim %, indirim bitişi, tek seferde en fazla, pilot başına sınır, satışta | Bir sonraki listeleme ve satın almada |
| Görevler | `quests.read/write` | aynı | başlık, açıklama, yayında, başlangıç/bitiş, seviye aralığı | Görev listesi; yayını yapan API süreci önbelleği anında tazeler, diğer süreçler ≤2 sn |
| Haritalar | `maps.read/write` | aynı | ad, giriş seviyesi, PvP, bakımda (kapalı), kapanış sebebi | Kapatılan haritadaki pilotlar şirket haritasına taşınır; PvP açık odaya anında |
| Oyun ayarları | `settings.read/write` | `settings.write` | kayıt, başlangıç paraları, şirket değiştirme, tamir, envanter, görevler, savaş, sohbet (yasaklı kelimeler dahil), klan, sosyal, forum, destek, açık artırma, yönetim eşikleri | İstek başına; savaş/sohbet/sosyal ayarları oyun sunucularına da bildirilir |

**Akış:**
1. **Taslak:** Değişiklikler alan tanımına göre doğrulanır (tür, alt/üst sınır, uzunluk); çapraz kurallar da denetlenir (etkinlik görevinde tarih zorunlu, kapatılan haritada sebep zorunlu). Veritabanı **değişmez**. Kayıt başına tek taslak olur; yeni taslak eskisini geçersiz kılar.
2. **Önizleme:** Yayındaki ↔ yeni fark tablosu ve etki tahmini. Örnekler: "3 haritada aynı anda en fazla 21 adet", "47 pilotun hangarında var", "son 30 günde 12 satın alma".
3. **Yayın:** Tek transaction'da yürür: tablo güncellemesi, sürüm durumu ve denetim kaydı (önceki/sonraki değerler, not). Ardından oyun sunucularına olay gider.
   - **İyimser kilit:** Taslak hazırlanırken başka bir yayın veya geri alma olduysa yayın 409 `REVISION_CONFLICT` ile reddedilir. Kayıt veritabanında doğrudan değiştirildiyse de aynı hata döner.
4. **Geri alma:** Eski bir sürüm seçilir; verisi yeni bir yayın sürümü olarak uygulanır ve yayındaki sürüm "geri alındı" olur. İlk düzenlemede kaydın hali "sürüm 1 (ilk durum)" olarak saklandığı için ilk değişiklik de geri alınabilir.
5. **Yeni etkinlik görevi:**
   - Oluşturma: kod, başlık, açıklama, tarih, tek hedef (NPC yok et, harita ziyaret, kargo, hasar, mesafe, geçit) ve ödül (Kredi, deneyim, şeref).
   - Görev **yayımlanmadan** oluşur, oyuncular görmez. "Yayında" alanı açılıp yayımlanınca görünür.

## 5. İki yetkili onayı
| İşlem | Ne zaman | Onaylayabilen |
|---|---|---|
| Para / eşya verme | Tutar eşiği aşınca (`game_settings.admin`: 1.000.000 Kredi, 5.000 Akçe, 50 eşya; panelden değiştirilebilir) | `economy.grant` veya `approvals.review` |
| Kalıcı ban | Her zaman | `players.ban` veya `approvals.review` |
| Süper Yönetici ataması | Her zaman | `approvals.review` (Süper Yönetici) |

- **Talep eden kendi talebini onaylayamaz/reddedemez:** kodda `APPROVAL_SELF` ve veritabanında `approval_two_person` CHECK kısıtı.
- **Çıkar çatışması:** İşlemden yararlanan da onaylayamaz (kendi pilotuna para, kendi Süper Yönetici ataması).
- **Süre:** 72 saat (`approval_hours`); süresi dolan talep onaylanamaz.
- **Yürütme:** Onayla aynı transaction'da yürür. Yürütme hata verirse (ör. pilot silinmiş) talep "uygulanamadı" olarak kapanır ve hiçbir değişiklik uygulanmaz.
- **Defter ve denetim:** Para defterinde işlemi **başlatan** yönetici, denetim kaydında **onaylayan** görünür.

## 6. Bakım modu ve duyuru
- **Bakım modu açık:** Oyun bileti personel dışına `503 MAINTENANCE` (bakım mesajıyla) döner. Oyundaki oyuncular mesajla çıkarılır (kapanış kodu 4011); personel oyunda kalır. Site, forum ve destek açık kalır.
- **Duyuru:** Tüm oyun sunucusu süreçlerindeki çevrimiçi pilotlara anında "📢 …" bildirimi gider.

## 7. REST uçları (özet; tam liste `ADMIN_ROUTE_SPECS`)
| Uç | Yetki |
|---|---|
| `GET /admin/dashboard` · `GET /admin/system` | `dashboard.view` · `system.read` |
| `POST /admin/system/maintenance` `{enabled, message, reason}` · `POST /admin/system/broadcast` `{text, reason}` | `system.maintenance` · `system.notifications` |
| `GET /admin/players?q=` · `GET /admin/players/:userId` | `players.read` |
| `POST /admin/players/:userId/{warn,mute,suspend,ban,lock}` `{reason, publicReason?, hours?, reportId?}` | sırasıyla `players.warn`, `chat.moderate`, `players.ban`, `players.ban`, `players.lock` |
| `POST /admin/players/:userId/{unmute,unban,unlock}` `{reason}` · `/sessions/revoke` | `chat.moderate`, `players.unban`, `players.lock` · `players.sessions.revoke` |
| `POST /admin/players/:userId/roles` `{role, grant, reason}` · `GET /admin/roles` · `/admin/roles/:role/members` | `roles.assign` · `roles.read` |
| `GET /admin/economy/catalog` · `POST /admin/economy/grant` `{playerId, kind, code, amount, reason}` | `economy.grant` |
| `GET /admin/approvals` · `POST /admin/approvals/:id/review` `{approve, note?}` | `dashboard.view` (+ servis denetimi) |
| `GET /admin/reports?status=` · `POST /admin/reports/:id/resolve` `{status, note?}` | `chat.reports.read` · `chat.moderate` |
| `GET /admin/audit?actor=&action=&targetType=&targetId=&before=` | `audit.read` |
| `GET /admin/content/:tür` · `GET /admin/content/:tür/:id` | türün okuma yetkisi |
| `POST /admin/content/:tür/:id/drafts` `{changes, note?}` · `/revisions/:rid/discard` | türün yazma yetkisi |
| `POST /admin/content/:tür/revisions/:rid/publish` · `/rollback` | `content.publish` / `content.rollback` (+ yazma); ayarlarda `settings.write` |
| `POST /admin/quests` | `quests.write` |
| `GET /admin/clans?q=` · `GET /admin/clans/:id` | `clans.read` |
| `GET /admin/forum/categories` · `POST /admin/forum/categories[/:id]` · `POST /admin/forum/moderators` | `forum.read` · `forum.categories.write` · `forum.moderators.assign` |

**Yeni hata kodları:** `USER_NOT_FOUND`, `CONTENT_NOT_FOUND`, `REVISION_CONFLICT`, `NO_CHANGES`, `APPROVAL_NOT_FOUND`, `APPROVAL_CLOSED`, `APPROVAL_SELF`, `ROLE_RANK`, `SANCTION_NOT_FOUND`, `REPORT_NOT_FOUND`, `QUEST_CODE_TAKEN`, `MAINTENANCE`, `MUTED`.

## 8. Oyun sunucusu entegrasyonu (Redis)
- **`game:admin` kanalı:**
  - `content`: içerik yeniden yükleme
  - `ships`: gemi değerleri
  - `map`: PvP + kapatma denetimi
  - `social-config`
  - `sanction`: atma veya susturma yenileme
  - `maintenance`
  - `announce`
- **`game:node:<süreç>`:** 5 sn'de bir nabız ve metrik yazılır (15 sn ömürlü); pano ve sistem sayfası okur.
- **Protokol:**
  - NPC varlık bilgisine azami can (`mh`) eklendi.
  - Bakım kapanış kodu `4011` eklendi.
  - Kapanıştan önce gelen `kick` mesajının metni (ban gerekçesi, bakım mesajı) oyuncuya gösterilir.
