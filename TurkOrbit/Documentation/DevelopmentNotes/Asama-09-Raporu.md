# Aşama Raporu — Aşama 9: NPC ve savaş

**Tarih:** 27.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-09-NPC-Savas.zip`

> **Kapsam notu:**
> - Bu aşama savaşın **sunucu otoriteli çekirdeğidir**: hedef seçme, lazer ve roket ateşi, hasar ve kalkan, NPC yapay zekâsı, pilotun ölümü ve yeniden doğması, ödül ve kargo kutusu, PvP kuralları.
> - **Yıldız Kapıları** (dalgalı kapı haritaları) ve bunlara bağlı aileler (Kırkayak, Tepegöz, Gök Ejderi) bu aşamada **yok**. Görev ve ekonomi sistemleriyle birlikte Aşama 10-11'de gelecek.
> - NPC değerleri veritabanındadır, ama Yönetim Merkezi'nden **canlı** değiştirme Aşama 14'tedir. Şimdilik SQL ve oyun sunucusunu yeniden başlatma gerekir.

Kurallar ve protokol: [Savaş Kuralları ve Protokol](../Asama-09-NPC-Savas/Savas-Kurallari-ve-Protokol.md) · Kurulum: [Güncelleme Rehberi](../Asama-09-NPC-Savas/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)

## 1. Tamamlanan işler

| İstenen | Durum | Ayrıntı |
|---|---|---|
| Hedef seçme | ✅ | Tıklama/dokunma (sunucuda radar menzili denetimi), **Tab** ile en yakın/sıradaki hedef, telefonda 🎯 butonu, **Esc** ile bırakma. Hedef paneli: ad, seviye, can ve kalkan çubukları |
| Lazer ateşi | ✅ | Atış aralığı lazerin tur hasarı / saniyelik hasarından (başlangıç lazeri 1 sn). Menzil 600. İstemci yalnızca "ateş aç/kapa" gönderir; atış hızını hızlandıramaz (test) |
| Mühimmat | ✅ | 5 tür (IŞK-1…4 ×1–×4; SE-50 ×2 ve hedefin kalkanına verdiği hasarın %25'ini kendi kalkanına çeker). Her atış bir mühimmat harcar; biten mühimmatta ateş durur. Sayaç sunucuda; 5 sn'de bir defterli (`ammo_used`) yazılır |
| Roketler | ✅ | 4 tür: Yıldırım, Şimşek, Tufan (hedefin 200 birim çevresine alan hasarı), Buz (yavaşlatma). Bekleme süresi ve stok denetimi sunucuda |
| Hasar ve kalkan | ✅ | Kalkan emme oranı kadar hasarı kalkan alır, kalanı gövdeye gider; ±%10 sapma; kalkan savaş dışında yenilenir |
| NPC'ler | ✅ | 4 aile, **11 tür** (2 kadim/boss: Akrep Kraliçe, Ana Örümcek); 21 haritada **111 doğma alanı**, en fazla 414 canlı NPC. Değerler `0005_combat.sql`'de |
| NPC yapay zekâsı | ✅ | Pasif sürü (vurulunca sürü yardıma gelir), saldırgan, vur-kaç. Zehir (kalkanı atlayan zamanla hasar), yavaşlatma, dolaşma, bağ mesafesi (yuvadan kopmaz), yenilenme, yeniden doğma |
| Güvenli bölge | ✅ | İstasyon ve güvenli bölgede saldırı yapılamaz ve saldırıya uğranmaz; NPC güvenli bölgeye giremez |
| PvP kuralları | ✅ | Yalnızca PvP açık haritada ve düşman şirkete. Yenen şeref (100) ve `player_kills` kazanır |
| Ölüm ve yeniden doğma | ✅ | Patlama, ölüm ekranı, ölüm kaydı. **İstasyonda yeniden doğ:** şirket haritasında %10 canla. Bağlantı kopukken ölen pilot tekrar bağlanınca otomatik doğar |
| Ödül | ✅ | Kredi, Akçe (şanslı), deneyim, şeref, seviye atlama. Tek transaction ve idempotent anahtar; ödül mesajı yazımdan **sonra** gönderilir |
| **Katkıya göre paylaşım** | ✅ | Birden çok pilot vurursa Kredi/Akçe/deneyim/şeref hasar payına göre bölünür. Eşya, kargo kutusu ve öldürme kaydı en çok hasar verenindir. Haritadan ayrılanın payı kimseye verilmez (07 kabul ölçütü) |
| Kargo kutusu | ✅ | NPC'nin öldüğü yerde; yalnızca kargo algılama menzilinde (600) görünür. İlk 15 sn en çok hasar verene ait, 60 sn ömür. Üzerine gelince toplanır (`cargo_loot` defteri) |
| Onarım | ✅ | Oyundayken tamir yalnızca istasyonda; tamir edilen can oyuna anında yansır |
| Canlı envanter | ✅ | Mağazadan alınan mühimmat ve roket oyundaki sayaca anında eklenir |
| Efektler (istemci) | ✅ | Mühimmat rengine göre lazer çizgisi, roket izi, hasar sayıları (kalkan mavi, gövde turuncu), patlama + kamera sarsıntısı |
| HUD | ✅ | Can/kalkan çubukları, hedef paneli, mühimmat çubuğu (1–5), roket bekleme göstergesi, dokunmatik Ateş/Roket/Hedef butonları (joystick'in karşı tarafında), ölüm ekranı, mini haritada NPC ve kargo |
| Tuş ataması | ✅ | Ateş (Boşluk), roket (R), sonraki hedef (Tab) ayarlardan değiştirilebilir |

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0005_combat.sql`: 6 tablo + savaş ayarları + içerik |
| Ortak paket | `packages/shared/src/combat.ts` (hasar, saldırı izni, ödül zarı ve paylaşımı, efekt ve mesaj tipleri), `combat.test.ts` (11 test) |
| Oyun sunucusu | `apps/api/src/game/content.ts` (içerik yükleme), `apps/api/src/game/persistence.ts` (ödül, kargo, ölüm, mühimmat yazımları) |
| Testler | `apps/api/test/combat.test.ts` (14 test, gerçek WebSocket + PostgreSQL + Redis) |
| Belgeler | `Documentation/Asama-09-NPC-Savas/{Savas-Kurallari-ve-Protokol,Kurulum-ve-Dosya-Yerlestirme-Rehberi}.md`, bu rapor, 4 ekran görüntüsü (`ekran-goruntuleri/asama-09`) |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/game/server.ts` | Savaş, NPC odaları ve yapay zekâ, ölüm/yeniden doğma, ödül, kargo, efekt yayını, iş kuyruğu ve kapanışta boşaltma |
| `packages/shared/src/{net,world,index}.ts` | Protokol v2 mesajları ve şemaları, yeni tuşlar |
| `apps/api/src/modules/world/service.ts` | İstasyonda yeniden doğma, ölü gemiyle bağlanınca otomatik doğma |
| `apps/api/src/modules/{hangar/service,hangar/stats,game/bridge}.ts` | Tamir/satın alma/satışta oyun sunucusuna gerekçeli bildirim (`repair`, `inventory`) |
| `apps/client/src/game/{controller,SpaceScene,textures}.ts` | Savaş durumu, hedef, efektler, NPC ve kargo görselleri, yavaşlatmalı tahmin |
| `apps/client/src/{components/game/GameHud.tsx, components/game/SettingsPanel.tsx, pages/GamePage.tsx, styles/game.css}` | Savaş HUD'u, tuşlar, ölüm ekranı |
| `apps/api/test/{game.test.ts, helpers.ts}` | Hareket testleri gerçek NPC'leri kapatarak çalışır; savaş ayarı test sıfırlamasında |
| `scripts/e2e-auth.mjs`, `scripts/ui-e2e.mjs` | NPC öldürme, ödül, kargo, ölüm ve yeniden doğma adımları |
| `database/schema-draft.sql` | NPC ve ödül tabloları taslaktan çıkarıldı (0005'e taşındı) |
| `Documentation/{02,04,06,07}`, `Asama-08-Multiplayer/Protokol.md`, README'ler, Karar Günlüğü | Durum, 0005 tabloları, protokol v2 notu, K-046…K-053 |

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 59/59. Yeni: hasar/kalkan, saldırı izni, ödül zarı, **ödül paylaşımı** (yuvarlama, ayrılan pilot, toplam aşılmaz), savaş mesajı şemaları |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis + WebSocket**) | ✅ 148/148 (14 yeni savaş testi) |
| API uçtan uca (gerçek API + oyun sunucusu süreçleri + SMTP) | ✅ 36/36 adım (yeni: WebSocket ile NPC öldürme ve defterli ödül) |
| Tarayıcı uçtan uca (Chromium: iki masaüstü + iPhone 13 dikey/yatay) | ✅ 45/45 adım |
| `npm run build`, `npm audit` | ✅ / 0 açık |
| Şema doğrulama | ✅ 0001 → 0005 + taslak boş veritabanına hatasız yüklendi (93 tablo; 11 NPC türü, 52 ödül satırı, 111 doğma alanı) |

**Savaş entegrasyon testlerinde doğrulananlar** (tik elle ilerletilir, rastgelelik sabit):
- **Atış:** 42 tikte (≈2 sn) tam 3 atış, her biri 40 hasar ve bir mühimmat. Menzil dışına (1000 > 600) ateş edilmedi. Radar dışındaki veya olmayan varlık hedeflenemedi. Saniyede onlarca ateş/hedef mesajı atış hızını artırmadı.
- **Ödül:** 500 Kredi + 6000 deneyim, seviye 1 → 2, `npc_kill_log` kaydı ve `npc_kills = 1`. Şansı tutmayan Akçe verilmedi. Kargo kutusu toplanınca 30 IŞK-1 eklendi; harcanan 3 mühimmat defterden düştü, envanterde 2027.
- **Paylaşım:** Üç pilot aynı NPC'yi vurdu. Biri bir atıştan sonra oyundan çıktı (%10). Kalan ikisi Kredi ve deneyimi paylarına göre aldı, toplam 900 (çıkanın %10'u kimseye verilmedi). Eşya ve öldürme kaydı en çok hasar verene gitti; defter ve oyuncu satırları mesajlarla birebir tuttu.
- **Kargo:** Kutu 15 sn boyunca başkası tarafından alınamadı, süre dolunca alındı. NPC süresi sonunda yeniden doğdu.
- **Yapay zekâ:** Saldırgan NPC yaklaşan pilota saldırdı; zehir zamanla hasar verdi, yavaşlatma hızı 320'den 160'a düşürdü. NPC güvenli bölgedeki pilota saldırmadı ve bölgeye girmedi.
- **Ölüm:** Ölüm kaydı yazıldı, gemi canı 0 oldu. "Yeniden doğ" ile K-2'den K-1 istasyonuna, 4000 canın %10'u (400) ile döndü. Bağlantı kopukken ölen pilot tekrar bağlanınca istasyonda doğdu ve bildirim aldı.
- **PvP:** Aynı şirkete ve PvP kapalı haritada saldırı engellendi. Düşman şirketten pilot PvP haritasında yok edildi, yenen 100 şeref aldı.
- **Roket ve envanter:** Roket hasar verdi, bekleme süresi uygulandı, bir roket harcandı. Mağazadan alınan mühimmat oyundaki sayaca anında eklendi (3000). İstasyon dışında tamir reddedildi; istasyonda tamir edilen can oyuna anında yansıdı.

**Tarayıcıda gerçekten denenen savaş senaryoları** (deneme NPC'leriyle):
- Tab ile hedefleme, hedef panelinde ad ve can.
- Boşluk ile ateş: lazer çizgileri ve hasar sayıları göründü. NPC yok edildi; ödül ve "Seviye atladın!" bildirimi geldi, defterde kayıt bulundu.
- Kargo kutusuna tıklayınca gemi gitti ve kutuyu topladı; IŞK-1 sayısı tam 30 arttı.
- Saldırgan NPC pilotu yok etti; ölüm ekranından "İstasyonda yeniden doğ" ile istasyonda "400 / 4.000" canla devam edildi.
- Telefonda Ateş butonu görünür. Oyun ekranlarında JavaScript hatası oluşmadı.
- Ekran görüntüleri incelendi. Bulunan iki görsel kusur düzeltildi (§5.7).

**FPS ve ping (dürüst not):**
- Ekran kartı olmayan test sunucusunda yazılımsal çizimle savaş sırasında 18–21 FPS (masaüstü) ve 39–42 FPS (iPhone emülasyonu) ölçüldü. Bu değerler gerçek cihaz performansını göstermez.
- Ping, Aşama 8'deki gibi bu ortamda güvenilir değil.
- Telefonda dokunmatik savaş butonları yalnızca emülasyonla denendi; **gerçek telefonda denenmedi** (Aşama 15).

## 5. Geliştirme sırasında bulunan ve düzeltilen sorunlar
1. **Tip uyuşmazlığı (yeniden doğma):** `respawnTx` sorgusunda oran parametresi tamsayı sanıldı (`22P02`). `$2::numeric` ile düzeltildi.
2. **Büyük sayılar metin geliyordu:** PostgreSQL `bigint` miktarları JavaScript'e metin olarak geliyor. Mühimmat sayacı "2000" + 30 gibi birleştirme hatasına açıktı. Sayıya çevrildi ve test eklendi.
3. **Hasarı olmayan NPC ışın atıyordu:** Pasif, hasarı 0 olan NPC görsel ışın gönderiyordu. `damage > 0` koşulu eklendi.
4. **Kapanıştan sonra veritabanı yazımı (kilitlenme):** "Ateşle ve unut" yazımları sunucu kapandıktan sonra sürüyordu; testlerde `TRUNCATE` ile kilitlendi. Tüm arka plan işleri izleniyor ve kapanışta boşaltılıyor. Düzeltmeden sonra savaş ve oyun test takımı art arda 4 kez 33/33 geçti.
5. **Test zamanlaması:** Test yardımcısı, sunucu mesajları işlemeden tik ilerletiyordu. Önce mesajların işlenmesi bekleniyor. Uçtan uca testte ödül mesajı patlama anlık görüntüsünden önce gelebildiği için adım anlık görüntüyü de bekliyor.
6. **Türkçe ek hatası:** "Seviye 2'e" yerine "Seviye atladın! Artık seviye 2." yazılıyor.
7. **Görsel kusurlar (ekran görüntüsünden):** Mühimmat kutusundaki tuş ipucu adın üstüne biniyordu ("TabHedef"); iç boşluk düzeltildi. Yakın gemilerin ad etiketleri üst üste biniyordu; yazı boyutu küçültüldü.
8. **Plan farkı:** İlk taslakta ödülün tamamı en çok hasar verene gidiyordu. 07'deki kabul ölçütü ("katkıya göre bölünür") ile karşılaştırınca katkı paylaşımı eklendi ve testlendi (K-047).
9. **Tarayıcı testinde zincirleme hata (test altyapısı):** Bir koşuda, test sürerken ortak paket yeniden derlendi (geliştirme veritabanına migration komutu derlemeyi de çalıştırıyor). Vite açık sayfaları yeniledi; "oyun sunucusu yeniden başlatılır" adımı başarısız oldu ve sunucuyu yeniden başlatmadan çıktığı için sonraki adımların hepsi başarısız oldu. Aynı derleme kasıtlı olarak tekrarlanarak neden doğrulandı (oyun sunucusu çökmedi; günlüğünde hata yok). Adım artık her durumda sunucuyu yeniden başlatıyor. Oyun sunucusu günlüğü `test-results/ui-e2e-game.log` dosyasına yazılıyor. Testler bu tür bir eşzamanlı derleme olmadan baştan koşturuldu (§4).

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Yıldız Kapıları (dalgalı kapı haritaları), Kırkayak, Tepegöz ve Gök Ejderi yok | Aşama 10-11 (görev ve ekonomiyle) |
| 2 | NPC, ödül ve savaş ayarı değişikliği oyun sunucusu yeniden başlatılınca yansır; doğma alanları harita odası açılırken okunur. **Canlı NPC'ye anında yansıma yok** (07 kabul ölçütünün bu kısmı) | Aşama 14 (Yönetim Merkezi + `content:updated` yayını) |
| 3 | Roket fırlatıcı (toplu roket salvosu), gemi yetenekleri ve PET savaşı yok | Aşama 10-11 |
| 4 | `map_zones` içindeki `no_pvp` türü henüz kullanılmıyor (içerikte bu türde bölge yok). Güvenli bölge `safe` ve `station` | Gerektiğinde Aşama 12 |
| 5 | Başarımlar savaştan anında değil, profil açılınca değerlendiriliyor (Aşama 5 kuralı) | Aşama 10 (olay tabanlı ilerleme) |
| 6 | Öldürme kaydı ve `npc_kills` yalnızca en çok hasar verene. Yardım (asist) sayacı yok | Aşama 10'da görev ilerlemesiyle değerlendirilecek |
| 7 | Mühimmat 5 sn'de bir yazılır; sunucu çökerse son en fazla 5 sn'lik tüketim kaydedilmeyebilir (oyuncu aleyhine değil) | Bilinçli karar (K-050) |
| 8 | Yük testi (yüzlerce NPC ve pilotla tik süresi) yapılmadı | Aşama 16 |
| 9 | Gerçek telefonda dokunmatik savaş denenmedi; yalnızca emülasyon | Aşama 15 |
| 10 | NPC görselleri kodla üretilen basit siluetlerdir (özgün, telif riski yok); son sanat çalışması değil | Görsel iyileştirme sonraki aşamalarda |

## 7. Sonraki aşama
**Aşama 10: Görev sistemi.**
- Olay tabanlı görev motoru: NPC öldürme, kargo toplama, harita ziyareti, PvP.
- ~300 görev, günlük ve haftalık görevler ile sıfırlama.
- Görev ödülleri: aynı ödül tabloları ve defterler.
- Başarımların anında değerlendirilmesi.

## 8. ZIP teslimatı ve derleme
`TurkOrbit/Deliveries/TurkOrbit-Asama-09-NPC-Savas.zip` (Aşama 1–8 dahil tam proje). `node_modules`, `dist` ve `.env` içermez.
