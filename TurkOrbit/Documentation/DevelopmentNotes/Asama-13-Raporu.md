# Aşama Raporu — Aşama 13: Forum ve Destek

**Tarih:** 28.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-13-Forum-Destek.zip`

> **Kapsam:**
> - 07'deki Aşama 13 satırı: oyun hesabıyla ortak forum ve destek talepleri.
> - Kabul ölçütleri:
>   1. "Kilitli konuya yanıt reddedilir."
>   2. "Ek dosya türü/boyut sınırı."
>   3. "Talep numarası benzersiz."
>
>   Üçü de entegrasyon testi, API uçtan uca testi ve tarayıcı testiyle doğrulandı.

Kurallar ve API: [Forum ve Destek Kuralları ve API](../Asama-13-Forum-Destek/Forum-ve-Destek-Kurallari-ve-API.md) · Kurulum: [Güncelleme Rehberi](../Asama-13-Forum-Destek/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)

## 1. Tamamlanan işler

| İstenen | Durum | Ayrıntı |
|---|---|---|
| Ortak hesapla forum | ✅ | Oyun hesabıyla aynı oturum. Okuma oturumsuz açık; yazma doğrulanmış e-posta ister. Yazarın yanında pilot şirketi, seviyesi, klan etiketi ve personel rolü görünür |
| Bölümler | ✅ | 6 bölüm. Duyurularda konuyu yalnızca ekip açar (bölüm bazlı konu açma yetkisi). Sabit ve kilitli "Topluluk Kuralları" konusu |
| Konu, yanıt, alıntı | ✅ | Düz metin (HTML yorumlanmaz), küfür filtresi, sayfalama. Alıntı, takip ve "yanıt/alıntı" bildirimleri. 24 saatlik düzenleme süresi. Yumuşak silme |
| **Kilit** | ✅ | Kilitli konuya oyuncu yanıtı `409 THREAD_LOCKED`. Konu satırı kilitlenerek okunur; kilitle aynı anda gelen yanıtlarda sayaçlar tutarlı kalır. Moderatör yazabilir |
| Moderasyon | ✅ | Sabitle, kilitle, taşı, sil, geri getir. Genel (`forum.moderate`) veya bölüm moderatörü. Her işlem `admin_audit_log`'a yazılır; konu sahibine bildirim gider |
| Beğeni, takip, arama | ✅ | Beğeni kullanıcı başına bir kez sayılır, kendi mesajın beğenilemez. Arama kelime başı eşleşmesiyle Türkçe eklere dayanıklı ("gemi" → "gemileri") ve sonuçlar vurgulu. Görüntülenme Redis'le saatte bir sayılır |
| Şikâyet | ✅ | Forum mesajı ve konu şikâyeti, içeriğin anlık kopyasıyla Aşama 12 `reports` kuyruğuna düşer |
| **Destek talebi** | ✅ | Numara `TO-<yıl>-<6 hane>` (PostgreSQL dizisi + UNIQUE). 7 konu türü, açık talep sınırı 5. Platform ve sürüm kaydı. Durum akışı: ekip yanıtı bekleniyor → oyuncu yanıtı bekleniyor → çözüldü → kapatıldı. Çözülen talep 7 gün sonra kendiliğinden kapanır |
| **Ek dosya** | ✅ | Tür **içerikten** tespit edilir (PNG, JPEG, WEBP, PDF, TXT); boyut 5 MB, mesaj başına 3, ekleme süresi 30 dk. Dosya adı temizlenir. Dosya veritabanına değil dosya deposuna yazılır. İndirme yalnızca yetkiliye ve `attachment` + `nosniff` ile |
| Destek masası (personel) | ✅ | Kuyruk (öncelik ve durum sırası, süzgeçler), atama, öncelik, durum. Oyuncuya görünmeyen iç not. Yanıtta oyuncuya bildirim ve e-posta. Yetkiler `support.read/reply/manage` |
| Arayüz | ✅ | `/forum`, `/forum/:bölüm`, `/forum/konu/:id`, `/forum/ara`, `/destek`, `/destek/:no`, `/destek/masa`, `/destek/masa/:no`. Misafir üst çubuğunda "Forum". Telefonda tek sütun |

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0009_forum_support.sql` (9 tablo, `support_ticket_seq`, bölümler, kurallar konusu, ayarlar) |
| Ortak paket | `packages/shared/src/community.ts`, `community.test.ts` (5 test) |
| API | `apps/api/src/modules/forum/{service,routes}.ts`, `modules/support/{service,routes,emails}.ts`, `lib/storage.ts` |
| İstemci | `apps/client/src/pages/{ForumPages,SupportPages}.tsx` |
| Testler | `apps/api/test/community.test.ts` (9 test) |
| Belgeler | `Documentation/Asama-13-Forum-Destek/*`, bu rapor, ekran görüntüleri (`ekran-goruntuleri/asama-13`) |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/{app.ts, config/env.ts}`, `.env.example`, `.gitignore` | Forum, destek ve dosya deposu bağlantısı; `UPLOAD_DIR`; `var/` yok sayılır |
| `apps/api/src/modules/auth/emails.ts` | E-posta şablon yardımcıları dışa açıldı (destek yanıtı e-postası aynı görünümü kullanır) |
| `packages/shared/src/{api-types,index}.ts` | 11 hata kodu, yeni modülün dışa aktarımı |
| `apps/client/src/{App.tsx, components/Layout.tsx, api/client.ts, components/social/ReportDialog.tsx, styles/global.css}` | Yollar, menü (Forum, Destek; misafir çubuğunda Forum), dosya yükleme, forum şikâyeti, stiller |
| `apps/api/src/game/server.ts`, `apps/api/test/game.test.ts` | **Hata düzeltmesi:** odaya girişi tamamlanmamış pilotta oyun sunucusunun çökmesi (bkz. §5.1) ve regresyon testi |
| `apps/api/test/helpers.ts`, `scripts/{e2e-auth,ui-e2e}.mjs` | Test ayarları (forum, destek, geçici yükleme klasörü), yeni uçtan uca adımlar |
| `scripts/package-phase.mjs` | Yüklenen dosyalar (`var/`) teslimat ZIP'ine girmez |
| `database/schema-draft.sql` | Forum ve destek tabloları taslaktan çıkarıldı |
| `Documentation/{04,06,07}`, README'ler, Karar Günlüğü | Durum, 0009 tabloları, K-082…K-091 |

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 90/90 (5 yeni) |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis**, gerçek dosya deposu) | ✅ 197/197 (10 yeni: 9 forum/destek + 1 oyun sunucusu regresyon testi) |
| API uçtan uca (gerçek API + oyun sunucusu süreçleri, gerçek SMTP) | ✅ 52/52 adım (4 yeni). Ayrıntı için aşağıdaki nota bak |
| Tarayıcı uçtan uca (Chromium: 2 masaüstü + iPhone 13) | ✅ UI_SONUC adım (7 yeni) |
| `npm run build`, `npm audit` | BUILD_SONUC |
| Şema doğrulama | ✅ 0001 → 0009 + taslak boş veritabanına hatasız (100 tablo) |

> **Açık not — API uçtan uca testinde rastgele bir hata:**
> - İlk koşuda Aşama 10'un "günlük görevler" adımı başarısız oldu ve sonraki adımlar zincirleme düştü.
> - **Sebep:** Pilot başına rastgele seçilen günlük görevlerden biri, testin kendi akışı sırasında (iki haritayı ziyaret) **tamamlanabiliyordu**. Adım yalnızca "aktif" görevleri saydığı için bazen eksik görüyordu.
> - Bu bir oyun hatası değil, testin yanlış varsayımıydı. Adım artık "aktif veya tamamlanmış" görevleri sayıyor.
> - Düzeltmeden sonra koşu yeniden yapıldı: 52/52.

**Doğrulananlar (entegrasyon testleri, gerçek içerikle):**
- **Forum okuma ve yazma:**
  - Bölümler oturumsuz açık. Oturumsuz ve e-postası doğrulanmamış hesap (`EMAIL_NOT_VERIFIED`) yazamadı. Oyuncu Duyurular'da konu açamadı.
  - Başlık küfür filtresinden geçti ("Bu ****** başlık"); fazla boş satırlar sadeleşti.
- **Yanıt, alıntı, takip:**
  - Takip edenler "yanıt", alıntılanan "alıntı" bildirimi aldı (kişi başına tek).
  - Sayfalama doğru. Aynı kişinin tekrar açması görüntülenmeyi bir saat içinde artırmadı.
- **Düzenleme, silme, beğeni:**
  - Başkası düzenleyemedi. Yazar süre içinde düzenledi ("düzenlendi" işareti); 25 saat sonra düzenleyemedi (`EDIT_WINDOW_PASSED`). Silinen mesajın içeriği gösterilmedi.
  - Kendi mesajı beğenilemedi. Aynı kullanıcıdan eşzamanlı 20 beğeni isteği tek beğeni sayıldı; geri alınca 0 oldu.
- **Kilit (kabul ölçütü):**
  - Oyuncu kilitleyemedi (`FORBIDDEN`).
  - Kilitleme ile **eşzamanlı 10 yanıt**: kabul edilen + `THREAD_LOCKED` alan = 10. `reply_count` ve mesaj sayısı kabul edilenlerle birebir aynı.
  - Kilitten sonra oyuncu `409` aldı; Türkçe mesaj görüldü, konu görünümünde `canReply: false` döndü. Moderatör yazabildi.
  - Kilitli konuda yazar mesajını düzenleyemedi. Konu sahibine "Konun kilitlendi" bildirimi gitti.
  - Sabitle → taşı → sil (oyuncuya 404, moderatöre açık) → geri getir. Denetim kaydında 5 işlem sırasıyla moderatörün adıyla var.
- **Bölüm moderatörü:**
  - Yalnızca kendi bölümünü yönetebildi.
  - Atamayı yalnızca `forum.moderators.assign` yetkili topluluk yöneticisi yapabildi.
  - Moderatörün sildiği mesajın yazarı sebebiyle bildirim aldı.
- **Arama:**
  - "gemi" "gemileri"ni buldu ve eşleşen kelime `[[ ]]` ile işaretlendi. Silinen içerik aranmadı.
  - Şikâyet kuyruğa içeriğin kopyasıyla düştü. Aynı içerik tekrar şikâyet edilemedi (`REPORT_EXISTS`); kendi mesajı şikâyet edilemedi.
- **Talep numarası (kabul ölçütü):**
  - 10 kullanıcı × 5 **eşzamanlı** talep → 50 farklı `TO-2026-NNNNNN`.
  - 6. açık talep `TICKET_LIMIT` aldı. Başkasının talebi `TICKET_NOT_FOUND` döndü.
  - Platform `android` ve sürüm `1.4.2` kaydedildi.
- **Ek dosya (kabul ölçütü):**
  - `../../etc/ekran görüntüsü<script>.png` adı `ekran görüntüsü_script_.png` oldu.
  - Uzantısı `.png` olan EXE `415 ATTACHMENT_TYPE` aldı. 5 MB üstü `413 ATTACHMENT_TOO_LARGE` aldı.
  - HTML içerikli dosya `text/plain` + `log.txt` olarak kabul edildi.
  - 4. dosya ve süresi geçmiş mesaja ekleme `ATTACHMENT_LIMIT` aldı. Başkası mesaja ekleyemedi.
  - Sahip dosyayı bayt bayt aynı indirdi (`attachment`, `nosniff`); başkası 404 aldı.
  - Veritabanında içerik yok; depodaki dosya bayt bayt aynı.
- **Durum akışı ve personel:**
  - Oyuncu personel uçlarına giremedi. Moderatör okuyabildi ama yanıtlayamadı.
  - İç not oyuncuya görünmedi ve durumu değiştirmedi.
  - Yanıt: oyuncu "Türk Orbit Destek" adıyla gördü; bildirim aldı. E-postada yanıt metni yok. Talep personele atandı.
  - Çözülen talep oyuncu yazınca yeniden açıldı. 7 gün sonra kendiliğinden kapandı; kapatılana yazılamadı (`TICKET_CLOSED`).
  - Durum ve öncelik değişikliği denetim kaydına yazıldı.

**Tarayıcıda gerçekten denenenler (iki ayrı masaüstü oturumu, iki hesap, telefon):**
- **Misafir:** Oturumsuz ziyaretçi bölümleri ve kilitli "Topluluk Kuralları" konusunu okudu; yazma yerine giriş bağlantısı gördü.
- **Forum:**
  - A, Rehberler'de konu açtı. B giriş yaptı, A'nın mesajını alıntılayarak yanıtladı ve beğendi.
  - A'nın zilinde "takip ettiğin konuya yanıt" bildirimi göründü.
- **Kilit:**
  - A'ya moderatör rolü verildi; A moderasyon çubuğundan konuyu kilitledi.
  - B'nin ekranında yanıt kutusu yerine "Bu konu kilitli; yeni yanıt yazılamaz." yazdı.
  - B'nin tarayıcısından doğrudan API isteği de 409 aldı.
- **Arama:** "gemi" araması sonucu getirdi; "gemileri" vurgulu göründü.
- **Destek:**
  - B'nin seçtiği `.png` uzantılı EXE tarayıcıda reddedildi.
  - Gerçek PNG ile talep açıldı; `TO-2026-000001` numarası göründü.
  - İndirilen ek, yüklenenle bayt bayt aynı çıktı.
- **Destek masası:**
  - A'ya destek personeli rolü verildi. A, Destek masasından talebi açtı; iç not ve yanıt yazdı.
  - Masada durum "Oyuncu yanıtı bekleniyor" oldu.
  - B, ekip yanıtını "Türk Orbit Destek" adıyla gördü, iç notu görmedi. Yanıt e-postası gerçek SMTP ile B'nin kutusuna düştü.
- **Telefon:** Forum konusu ve destek masası tek sütun açıldı; yatay taşma yok.
- Aşama 1–12'nin tüm adımları da yeniden geçti.

## 5. Geliştirme sırasında bulunan ve düzeltilen sorunlar
1. **Oyun sunucusu çökmesi (Aşama 8'den beri var olan, nadir bir yarış durumu):**
   - Tarayıcı testinin ikinci koşusunda oyun sunucusu süreci `TypeError: Cannot read properties of null (reading 'code')` ile kapandı; sonraki oyun adımları bağlanamadı.
   - **Sebep:** Oyuna giren pilot, odası veritabanından yüklenirken pilot listesine ekleniyordu. Tam o anda 5 saniyelik periyodik kayıt çalışırsa çevrimiçi durum yazılırken odası `null` olan pilota erişiliyordu. Bakım denetimi ve grup durumu turu da aynı riski taşıyordu.
   - **Düzeltme:** Oda, pilot listeye eklenmeden önce yükleniyor. Ayrıca bu üç periyodik iş odası henüz atanmamış pilotu atlıyor.
   - **Regresyon testi:** Pilot tam o ara durumdayken kayıt, bakım ve grup turu zorla çalıştırılıyor. Düzeltme geri alınınca test `TypeError` ile kırıldı, düzeltmeyle geçti.
   - Bu hata Aşama 13 koduyla ilgili değil; zamanlamaya bağlı olduğu için önceki aşamaların testlerinde ortaya çıkmamıştı.
2. **Türkçe aramada kök bulma:**
   - PostgreSQL'in `turkish` sözlüğü "gemi" kelimesini "ge" köküne indiriyor, sonuç tutarsız oluyordu.
   - Düzeltme: `simple` sözlük ve her kelime için kelime başı eşleşmesi (`gemi:*`). Ekli biçimler bulunuyor (K-084).
3. **Ek ekleme süresi (saat kaynağı):**
   - Mesaj zamanı veritabanı saatinden, ekleme süresi denetimi servis saatinden alınıyordu.
   - Testte saat ileri alınınca ekler reddediliyordu.
   - Mesaj ve konu zamanları artık servis saatinden yazılıyor; tek saat kaynağı var.
4. **Uzun forum mesajları:** Genel 16 KB gövde sınırı 20.000 karakterlik Türkçe mesajı (UTF-8'de 2 bayta kadar) reddediyordu. Forum uçlarında 128 KB, destek metin uçlarında 64 KB sınır tanımlandı; ek dosya ucu kendi 10 MB sınırıyla.
5. **Personel ekranında yanlış durum adı:** Destek masasında "Senin yanıtın bekleniyor" (oyuncu bakışı) yazıyordu. Personel için ayrı durum adları eklendi ("Oyuncu yanıtı bekleniyor").
6. **Görsel:**
   - Misafir görünümünde forum ana sayfası ve arama iki sütuna bölünüyordu; misafir düzeninin ana alanı tek kart için ortalanıyordu. Forum misafirde de tam genişlikte tek sütun akıyor.
   - Destek mesajlarında "Ekip" ve "İç not" rozeti ortada kalıyordu; artık yazar adının yanında.
   - Telefonda iç not onay kutusu etiketinden ayrı satıra düşüyordu; düzeltildi.
7. **API uçtan uca testi:** Rastgele günlük görev seçimine bağlı yanlış varsayım (yukarıdaki açık not).

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Forum ve sohbet şikâyetlerini inceleme, bölüm/moderatör yönetimi ve ayar değişikliği için yönetim ekranı yok; SQL ve API ile yapılır | Aşama 14 (Yönetim Merkezi) |
| 2 | Forum bildirimleri bildirim zili pilot üzerinden çalıştığı için yalnızca pilotu olan kullanıcılara gider; pilotsuz hesap forumu kullanabilir ama bildirim almaz | Hesap düzeyi bildirim, Aşama 14 |
| 3 | Ekler yalnızca yerel diske yazılıyor (tek sunucu). Birden çok API sunucusunda ortak depo gerekir | Nesne deposu (S3 uyumlu) sürücüsü, Aşama 16 |
| 4 | Eklerde virüs taraması yok. Tür içerikten doğrulanıyor ve dosyalar yalnızca indirme olarak sunuluyor, ama PDF içeriği taranmıyor | ClamAV gibi tarayıcı, Aşama 16 |
| 5 | Ekler, kapatılan talepler ve forum için saklama süresi ve temizlik görevi yok | Aşama 16 |
| 6 | Büyük harfle yazılmış "I" içeren kelimeler veritabanının küçük harf çevirisinde "i" olur (ölçüldü: "IŞIK" → "işik"). Bu yüzden "ışık" araması "IŞIK" veya "Işık" yazımını bulmaz. Küçük "ı" ile yazılmış kelimeler ve diğer harfler etkilenmez | Türkçe küçük harf dönüşümüyle ayrı arama sütunu, ihtiyaca göre |
| 7 | Forumda zengin metin (kalın, bağlantı, resim) yok; düz metin ve alıntı var | İhtiyaca göre (güvenli Markdown alt kümesi) |
| 8 | Destek talebine yanıt bekleme süresi (SLA) uyarısı ve hazır yanıt şablonları yok | Aşama 14 |
| 9 | Gerçek telefonda deneme yok; yalnızca emülasyon | Aşama 15 |

## 7. Sonraki aşama
**Aşama 14: Yönetim Merkezi.**
- Yetki tabanlı yönetim paneli: oyuncu arama, yaptırımlar (susturma, ban), şikâyet kuyruğu (sohbet, pilot, klan, forum), destek masası ve forum moderasyonu.
- Ekonomi ve içerik ayarları, denetim kaydı ekranları, etkinlik ve sıralama tabloları.

## 8. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-13-Forum-Destek.zip` (Aşama 1–12 dahil tam proje). `node_modules`, `dist`, `.env` ve yüklenen dosyalar (`var/`) içermez.
