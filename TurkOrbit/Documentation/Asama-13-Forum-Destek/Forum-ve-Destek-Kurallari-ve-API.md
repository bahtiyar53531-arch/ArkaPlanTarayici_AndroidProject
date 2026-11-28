# Aşama 13 — Forum ve Destek: Kurallar ve API

**Kurallar:** `packages/shared/src/community.ts` · **Servisler:** `apps/api/src/modules/{forum,support}/service.ts`
**Dosya deposu:** `apps/api/src/lib/storage.ts` · **Veri:** `database/migrations/0009_forum_support.sql`

> **İlkeler:**
> - Forum oyun hesabıyla ortaktır. Okuma herkese açık, yazma doğrulanmış e-posta ister.
> - Yetkiler sunucuda, veritabanındaki rol-yetki eşlemesinden okunur (`forum.moderate`, `forum.moderators.assign`, `support.read/reply/manage`). Oyuncu kendine yetki veremez.
> - Moderasyon ve destek yönetimi işlemleri değiştirilemez `admin_audit_log`'a yazılır.
> - Ek dosyalar içerikten doğrulanır, veritabanına gömülmez ve yalnızca yetkili kişiye "indirme" olarak verilir.

## 1. Forum

| Bölüm | Konu açma |
|---|---|
| Duyurular | Yalnızca ekip (`forum.moderate`); yanıt herkes |
| Genel Sohbet, Rehberler ve Taktikler, Klanlar ve İttifaklar, Öneriler, Hata Bildirimleri | E-postası doğrulanmış her oyuncu |

İçerikte "Topluluk Kuralları" konusu hazır gelir: sabit, kilitli, ekip imzalı.

- **Konu:** Başlık 5–140, mesaj 1–20.000 karakter.
  - Satır sonları korunur. Görünmez karakterler atılır. Başlık ve mesaj sohbetin küfür filtresinden geçer (kelime yıldızlanır).
  - Mesajlar düz metin olarak gösterilir; HTML yorumlanmaz.
- **Yanıt ve alıntı:**
  - Konu sahibi ve yanıt yazanlar konuyu otomatik takip eder.
  - Takip edenlere "takip ettiğin konuya yanıt", alıntılanana "seni alıntıladı" bildirimi gider. Kişi başına tek bildirim gider; bildirim kullanıcının pilotuna (zil) gider.
  - Başka konudaki mesaj alıntılanamaz.
- **Kilit (07 kabul ölçütü):**
  - Kilitli konuya oyuncu yanıtı `409 THREAD_LOCKED` ("Bu konu kilitli; yeni yanıt yazılamaz.") ile döner.
  - Konu satırı kilitlenerek okunur. Kilitleme ile aynı anda gelen yanıtlar tutarlıdır: kilitten sonra işlenen yanıt reddedilir, sayaçlar birebir doğrudur (testli).
  - Moderatör kilitli konuya yazabilir. Kilitli konuda mesajlar düzenlenemez.
- **Düzenleme:** Yalnızca yazar, yazdıktan sonraki 24 saat içinde düzenleyebilir (`game_settings.forum.edit_window_minutes`). "düzenlendi" işareti görünür.
- **Silme:**
  - Yazar kendi mesajını, moderatör herhangi bir mesajı siler.
  - Silme yumuşaktır: içerik okuyucuya gösterilmez ama kanıt olarak saklanır.
  - Moderatör silince yazar sebebiyle birlikte bildirim alır.
- **Beğeni:** Kendi mesajın beğenilemez. Kullanıcı başına bir beğeni (birincil anahtar); eşzamanlı istekte bile tek sayılır (testli).
- **Görüntülenme:** Aynı kullanıcı veya IP bir konuyu saatte bir kez sayar (Redis).
- **Moderasyon:**
  - İşlemler: sabitle/kaldır, kilitle/aç, başka bölüme taşı, konuyu sil/geri getir.
  - Yetki: genel `forum.moderate` (moderatör, topluluk yöneticisi, oyun yöneticisi, süper yönetici) veya **bölüm moderatörlüğü**.
  - Bölüm moderatörü `POST /forum/moderators` ile atanır (yetki: `forum.moderators.assign`).
  - Konu sahibi kilit, taşıma ve silmeden bildirim alır.
- **Arama:**
  - `GET /forum/search?q=` başlık ve mesajlarda arar. Her kelime için kelime başı eşleşmesi kullanılır; Türkçe ekler sorun olmaz ("gemi" → "gemileri", "taktik" → "taktikleri"). Kelimelerin hepsi geçmelidir.
  - Eşleşen kısım `[[ ]]` ile işaretli özet döner; istemci güvenli biçimde vurgular.
  - Silinen içerik aranmaz.
- **Şikâyet:**
  - `POST /forum/posts/:id/report` · `POST /forum/t/:id/report` → Aşama 12 `reports` kuyruğu (anlık içerik kopyasıyla).
  - Kendi içeriğini şikâyet edemezsin. Aynı içerik için açık şikâyet varken tekrar edilemez.

## 2. Destek talepleri

| Kural | Değer (`game_settings.support`) |
|---|---|
| Talep numarası | `TO-<yıl>-<6 hane>`, PostgreSQL dizisinden + UNIQUE kısıt (07 kabul ölçütü) |
| Açık talep sınırı | 5 (`max_open_tickets`) |
| Ek dosya türleri | PNG, JPEG, WEBP, PDF, düz metin (TXT) |
| Ek dosya boyutu | 5 MB (`max_attachment_bytes`; veritabanı üst sınırı 10 MB) |
| Mesaj başına ek | 3 (`max_attachments_per_message`) |
| Ek ekleme süresi | Mesajdan sonraki 30 dk (`attach_window_minutes`) |
| Kendiliğinden kapanma | Çözüldükten 7 gün sonra (`auto_close_days`) |

- **Konu türleri:** Hesap ve giriş, Ödeme ve Akçe, Hata bildirimi, Hile bildirimi, Yaptırım itirazı, Oyun içi sorun, Diğer.
- **Platform bilgisi:** Talep oluşturulurken istemcinin platformu ve sürümü (`X-Client-Platform`, `X-Client-Version`) kaydedilir.
- **Durum akışı:**

| Durum | Ne zaman |
|---|---|
| Ekip yanıtı bekleniyor | Talep açılınca veya oyuncu yazınca |
| Oyuncu yanıtı bekleniyor | Ekip yanıt verince (oyuncuya bildirim + e-posta) |
| Çözüldü | Personel çözdü; oyuncu yazarsa talep yeniden açılır |
| Kapatıldı | Oyuncu kapattı, personel kapattı veya çözüldükten 7 gün geçti; kapatılan talebe yazılamaz (`TICKET_CLOSED`) |

- **Erişim:** Oyuncu yalnızca kendi talebini görür; başkasının talebi için `TICKET_NOT_FOUND` döner (varlığı sızmaz).
- **İç not:** Personel iç not yazabilir. İç not oyuncuya hiçbir uçtan gösterilmez ve durumu değiştirmez. İç nota eklenen dosyayı yalnızca personel indirir.
- **Ekip görünürlüğü:** Oyuncu ekip mesajlarını "Türk Orbit Destek" adıyla görür; personelin kullanıcı adı gösterilmez.
- **E-posta:** Ekip yanıt verince oyuncuya e-posta gider: talep numarası ve bağlantı. Yanıt metni e-postaya konmaz.

### Ek dosyalar (07 kabul ölçütü)
1. **Yükleme:** `POST /support/tickets/:no/messages/:mesaj/attachments`.
   - Gövde: dosyanın kendisi (`Content-Type: application/octet-stream`). Dosya adı: `X-File-Name` (URL kodlu).
   - Personel kendi mesajına `/support/staff/...` ucuyla ekler.
2. **Tür:** İçerikten tespit edilir (sihirli baytlar). İstemcinin bildirdiği tür ve uzantı yok sayılır.
   - Uzantısı `.png` olan EXE → `415 ATTACHMENT_TYPE`.
   - Metin dosyası geçerli UTF-8 olmalı, NUL ve denetim karakteri içermemeli.
   - HTML veya SVG içeriği metin olarak kabul edilse bile yalnızca `text/plain` + `Content-Disposition: attachment` + `nosniff` ile sunulur; tarayıcıda çalışmaz.
3. **Boyut:** Sınır aşılırsa `413 ATTACHMENT_TOO_LARGE`. 10 MB üstü gövde, uç seviyesinde reddedilir.
4. **Sayı ve süre:** Mesaj başına 3 dosya. Yalnızca mesajın yazarı, 30 dk içinde ekleyebilir (`ATTACHMENT_LIMIT`). Kapatılan talebe dosya eklenemez.
5. **Dosya adı:** Yol bölümü ve tehlikeli karakterler atılır; uzantı içerikten belirlenen türe göre konur. Örnek: `../../etc/ekran<script>.exe` → `ekran_script_.png`.
6. **Depolama:**
   - İçerik veritabanına yazılmaz. `UPLOAD_DIR` altında rastgele anahtarla saklanır (`ab/<64 hane>`, klasör izinleri 700, dosya 600).
   - Veritabanında ad, tür, boyut ve SHA-256 tutulur.
   - Veritabanı işlemi başarısız olursa yazılan dosya silinir.
7. **İndirme:** `GET /support/attachments/:id`.
   - Talep sahibi veya `support.read` yetkili personel indirebilir.
   - Yanıt başlıkları: `attachment`, `nosniff`, `Cache-Control: private, no-store`.

### Personel (destek masası)
| Yetki | Kimde | Ne yapar |
|---|---|---|
| `support.read` | Destek personeli, moderatör, topluluk/oyun yöneticisi, salt okunur | Kuyruğu ve talepleri (iç notlar dahil) görür |
| `support.reply` | Destek personeli, topluluk yöneticisi | Yanıt ve iç not yazar |
| `support.manage` | Destek personeli, topluluk yöneticisi | Durum, öncelik ve atama değiştirir (denetim kaydına yazılır) |

- **Kuyruk sırası:** önce öncelik (acil → düşük), sonra durum (ekip yanıtı bekleyenler önce), sonra en eski güncelleme.
- **Süzgeçler:** durum, konu türü, bana atananlar.
- **Atama:** Yanıt veren personel, atanmamış talebe kendiliğinden atanır.

## 3. REST uçları (`/api/v1`)
| Uç | Kim | Açıklama |
|---|---|---|
| `GET /forum/categories` · `GET /forum/c/:slug?page=` · `GET /forum/t/:id?page=` · `GET /forum/search?q=` | Herkes | Okuma (IP başına 240/dk, arama 30/dk) |
| `POST /forum/threads` · `POST /forum/t/:id/replies` · `PATCH /forum/posts/:id` | Doğrulanmış | Konu (5/saat), yanıt (30/10 dk), düzenleme |
| `POST /forum/posts/:id/delete` · `/like` · `POST /forum/t/:id/follow` | Oturum | Silme, beğeni (120/dk), takip |
| `POST /forum/t/:id/moderate` | Moderatör | `{action: pin/unpin/lock/unlock/move/delete/restore, category?, reason?}` |
| `POST /forum/posts/:id/report` · `POST /forum/t/:id/report` | Oturum | Şikâyet (10/saat) |
| `POST /forum/moderators` | `forum.moderators.assign` | Bölüm moderatörü ata/kaldır |
| `GET /support/meta` · `GET /support/tickets` · `GET /support/tickets/:no` | Oturum | Sınırlar, taleplerim, talep |
| `POST /support/tickets` | Doğrulanmış | Yeni talep (günde 10) → `{ticket, messageId}` |
| `POST /support/tickets/:no/replies` · `/close` | Sahibi | Yanıt (30/saat) → `{ticket, messageId}`, kapatma |
| `POST /support/tickets/:no/messages/:mid/attachments` | Mesaj yazarı | Ek dosya (30/saat) |
| `GET /support/attachments/:id` | Sahibi / personel | İndirme |
| `GET /support/staff/tickets` · `GET /support/staff/tickets/:no` | `support.read` | Kuyruk, talep (iç notlarla) |
| `POST /support/staff/tickets/:no/replies` | `support.reply` | `{body, internal}` |
| `POST /support/staff/tickets/:no/update` | `support.manage` | `{status?, priority?, assignToMe?}` |

**Yeni hata kodları:** `FORUM_CATEGORY_NOT_FOUND`, `THREAD_NOT_FOUND`, `POST_NOT_FOUND`, `THREAD_LOCKED`, `EDIT_WINDOW_PASSED`, `TICKET_NOT_FOUND`, `TICKET_CLOSED`, `TICKET_LIMIT`, `ATTACHMENT_TYPE`, `ATTACHMENT_TOO_LARGE`, `ATTACHMENT_LIMIT`.

## 4. Arayüz
- **Forum:**
  - `/forum`: bölümler ve son konular; oturumsuz da açılır, misafir üst çubuğunda "Forum" bağlantısı var.
  - `/forum/:bölüm`: konular (sabitler üstte, sayfalama, "Yeni konu").
  - `/forum/konu/:id`: mesajlar, alıntı, beğeni, düzenle, sil, şikâyet et, takip et. Moderatörde moderasyon çubuğu var. Kilitli konuda yanıt kutusu yerine sebep yazar.
  - `/forum/ara`: vurgulu sonuçlar.
- **Destek:**
  - `/destek`: yeni talep (dosya türü ve boyutu tarayıcıda da önceden denetlenir) ve taleplerim.
  - `/destek/:no`: mesajlar, ekler (indirme), yanıt, kapatma.
- **Destek masası (personel):**
  - `/destek/masa`: kuyruk ve süzgeçler.
  - `/destek/masa/:no`: durum, öncelik, atama, yanıt ve iç not.
  - Bağlantı yalnızca `support.read` yetkisi olana görünür; uçlar yine sunucuda korunur.
