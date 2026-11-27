# Test Raporu — ORBITRAGAME.SPACE

## v1.2.0 — Hafif sürüm (27 Kasım 2026)

### Takılmaya yol açabilecek bulunan ve kaldırılan şeyler

| Bulunan | Neden sorun | Durum |
|---|---|---|
| FPS paneli açıkken 6 sn'de bir `Debug.getPss()` (bellek ölçümü) | Android'de pahalı bir çağrıdır; uygulama sürecinin bellek kilidini tutup WebView'in çizim iş parçacığını kısa süre bekletebilir → periyodik mikro takılma | **Kaldırıldı** |
| Her karede çalışan `FrameMetrics` dinleyicisi | Her karede ek geri çağrı | **Kaldırıldı** |
| 2 sn'de bir ping (TCP bağlantısı) + sistem belleği/pil/ısı sorguları | Sürekli arka plan işi | **Kaldırıldı** (ısı artık olay tabanlı, sorgusuz) |
| Panel her saniye tüm ekranı yeniden ölçtürüyordu (`requestLayout`) | Her saniye tam yerleşim turu | Yeni FPS rozeti **sabit boyutlu**, yalnızca kendini çizer |
| PC görünümünde oyunun tüm sayfa ağacını izleyen gözlemci + 2 sn'de bir zorunlu yerleşim | Oyun her karede yazı güncelledikçe kayıt üretir | Yalnızca pencere kaplarının doğrudan değişimi izlenir; tarama tarayıcı **boştayken** |
| Menü her açılışta 16 öğeyle yeniden kuruluyordu, gölge + resimli arka plan + karartma katmanı | Açılışta kısa takılma; açıkken her karede ek çizim | Bir kez kurulur, 6 öğe, düz arka plan, gölge/karartma yok |
| Otomatik kalite her değişimde ekranda bildirim | Gereksiz ayrıntı | Sessiz, en fazla bir kademe (x2 → x1,5) |

### Ölçüm: oyuna eklenen betiğin yükü (Chromium, ağır sahte oyun sayfası)

Sahte oyun: tam ekran canvas + 6 pencere, **her karede ~240 yazı/sayı güncellemesi**
(HP, kredi, görev sayaçları gibi). Chromium'un kendi sayaçlarıyla (CDP
`Performance.getMetrics`) 6 sn ölçüldü, 3 tekrarın ortalaması. Değerler
"saniyede ana iş parçacığında harcanan ms" (düşük = hafif):

| Yapılandırma | Betik süresi | Betiksize göre ek yük |
|---|---|---|
| Betiksiz (Chrome'daki gibi) | 136,0 ms/sn | — |
| Eski betik v1.1.0, FPS açık | 153,6 ms/sn | +17,6 |
| **Yeni betik v1.2.0, FPS açık** | **140,2 ms/sn** | **+4,2** (~4 kat hafif) |
| Eski betik v1.1.0, FPS + PC görünümü | 149,6 ms/sn | +13,6 |
| **Yeni betik v1.2.0, FPS + PC görünümü** | **138,2 ms/sn** | **+2,2** (ölçüm gürültüsü seviyesinde) |

Ek gözlem: PC görünümü açıkken yeni betik 9 saniyede yalnızca **3** tarama yaptı;
oyunun saniyede binlerce yazı güncellemesi pencere gözlemcisini **hiç** tetiklemedi.
Pencereleri elle CSS ile küçültmenin tarayıcıya ek maliyeti ölçülemeyecek kadar
küçük çıktı (yani PC görünümünün kendisi oyunu yormuyor).

> Bu ölçüm masaüstü işlemcide yapıldı; telefonda mutlak değerler daha büyük,
> oranlar benzerdir. Uygulama tarafındaki kazanç (bellek ölçümü, kare ölçer,
> ping kaldırıldı) bu ortamda ölçülemez; telefonda hissedilmesi beklenir.

### Otomatik testler (hepsi geçti)

| Test | Sonuç |
|---|---|
| `core` birim testleri (otomatik kalite alt sınırı dahil) | **21 / 21** |
| Robolectric arayüz testleri (açılış, video açılış, FPS rozeti, yeni menü + yaşam döngüsü) | **4 / 4** |
| Chromium: ölçüm betiği oyunu bozmuyor (FPS doğruluğu, WebSocket) | **15 / 15** |
| Chromium: PC görünümü + zoom + render kalitesi (sonradan açılan pencere dahil) | **26 / 26** |
| Android Lint (release) | 0 hata, kullanılmayan kaynak yok |

Testte yakalanıp düzeltilen hata: yeni menü ilk sürümde gereğinden geniş
ölçülüp ekranın sağından taşıyordu (üst satırdaki esnek boşluk) → düzeltildi.

### Cihazda bakılacaklar

- Oyun sırasında ara ara takılma azaldı mı? (FPS açıkken de)
- Menü hızlı açılıp kapanıyor mu?
- PC görünümü (Orta/Güçlü) üstteki pencereleri küçültüyor mu?

---

## v1.1.0 (27 Kasım 2026)

### Gönderilen ekran görüntülerinden teşhis

| Gözlem | Teşhis | Düzeltme |
|---|---|---|
| Ayarlarda ekranın alt ~%40'ı siyah, oyun (hotbar, joystick) üst kısma sıkışmış | Oyun sayfası daha kısa bir alana **yeniden yerleşmiş**: bir yazı alanı klavyeyi açtığında uygulama WebView'i klavye kadar küçültüyordu (ekranın %40'ı ≈ yatay klavye yüksekliği). Chrome klavyede sayfayı küçültmez. | Klavye için oyun alanı artık küçültülmüyor; gerekirse yalnızca yukarı kaydırılıyor. Ayrıca zoom'daki Android tarafı ölçekleme kaldırıldı (bu da çizim alanı hatasına yol açabiliyordu). |
| FPS 37, en düşük 6, "Hafif ısınma", 90 Hz ekran | Oyun 90 Hz'e yetişemiyor, cihaz ısınınca daha da düşüyor; en düşük 6 FPS büyük olasılıkla yukarıdaki yeniden yerleşme anı. | 60 Hz kararlı mod (varsayılan), otomatik render kalitesi, kararlı performans modu, ekran dışı ön-çizim kapalı, "oyun" kategorisi kaldırıldı (üretici FPS sınırlamaları). |

### Otomatik testler (hepsi geçti)

| Test | Sonuç |
|---|---|
| `core` birim testleri (+ otomatik kalite: düşürme, işe yaramazsa geri alma, ısınma; PiP ölçeği) | **22 / 22** |
| Robolectric arayüz testleri (video açılış dikey/yatay, PC görünümü paneli, menü, yaşam döngüsü) | **5 / 5** |
| Chromium: PC görünümü + oyun ölçeği + render kalitesi (`tools/js-probe-test/test_view.js`, senin ekran görüntündeki yerleşime benzer sahte oyun düzeniyle) | **24 / 24** |
| Chromium: ölçüm betiği oyunu bozmuyor (FPS, WebSocket) | **15 / 15** |
| Android Lint (release) | 0 hata |

`test_view.js` neyi doğruluyor: Gemi/P.E.T. sol üst köşeye, Görev takibi sağ üst
köşeye doğru %60 küçülüyor ve üst üste dizilim korunuyor; sürükleme ile taşınmış
pencere de doğru küçülüyor; hotbar/joystick/Pilot ve ortadaki oyuncu isimleri
değişmiyor; **canvas (gemi/harita) değişmiyor**; küçülmüş penceredeki düğmeye
dokunma doğru öğeye gidiyor; ayar kapatılınca her şey eski haline dönüyor;
oyun ölçeği %30 ve %140 çalışıyor; uzaklaştırınca oyun tuvali fiziksel
çözünürlükte kalıyor (gereksiz piksel yok); giriş sayfasında hiçbir şey değişmiyor.

### Hâlâ cihazda doğrulanması gerekenler

- PC görünümünün **gerçek oyun** penceresi yapısında çalışması (oyuna giriş
  yapamadığım için sahte düzenle test edildi). Panel "N arayüz öğesi küçültüldü"
  der; oyun ekranında 0 görürsen pencereler tuval içinde çiziliyor demektir.
- Klavye düzeltmesi: oyun ayarlarında / sohbette yazı alanına dokun → oyun
  küçülmemeli, siyah alan oluşmamalı.
- FPS'in Chrome'a yaklaşması (Performans menüsünden kalite ve Hz ile).
- Açılış videosunun oynaması (oynamazsa gerçekçi hareketsiz görüntü gösterilir).

---

## v1.0.0

Tarih: 27 Kasım 2026

## Önce açık konuşalım

Bu sürüm bir **bulut Linux sunucusunda** geliştirildi ve derlendi. Bu ortamda:

- **Fiziksel Android telefon/tablet yok.**
- **Android emülatörü çalıştırılamadı** (sunucuda donanım sanallaştırması / KVM yok;
  x86 Android imajları bu olmadan açılmıyor).
- **Oyun hesabı yok:** Giriş sayfasında kullanıcı adı + şifre + doğrulama kodu
  isteniyor; bu yüzden gerçek oyun ekranına (`/oyun`) girilip oyun, sohbet ve
  oyun sunucusu WebSocket'i **test edilemedi.** Ayrıca sitenin `robots.txt`
  dosyası `/oyun` ve oyun dosyalarının otomatik araçlarla çekilmesini yasaklıyor;
  buna uyuldu.

Bu nedenle aşağıdaki "cihazda test" maddeleri **senin telefonunda yapılmalı.**
Burada yapılabilen her şey otomatik testlerle doğrulandı.

## Burada yapılan otomatik testler ve sonuçları

| # | Test | Sonuç |
|---|---|---|
| A | `core` birim testleri (alan adı güvenliği, yükleme yüzdesi, FPS, ping, zoom, yeniden bağlanma, soket izleme) | **18 / 18 geçti** |
| B | Robolectric arayüz testleri (gerçek Skia çizimi): açılış ekranı dikey/yatay, %60 → %100 animasyonu, performans paneli, MainActivity açılış → menü açma → arka plan → ön plan → çıkış yaşam döngüsü | **3 / 3 geçti** (ekran görüntüleri `docs/screenshots/`) |
| C | Enjekte betik (`orbitra_probe.js`) gerçek Chromium motorunda, WebGL2 + WebSocket'li test oyunu ile (`tools/js-probe-test`) | **15 / 15 kontrol geçti** |
| D | Aynı betik gerçek `orbitragame.space/login` sayfasında (mobil Chromium) | Sayfa hatası yok; form ve sayfa normal çalıştı |
| E | Android Lint (release) | **0 hata**, yalnızca kozmetik uyarılar |
| F | Debug + release APK derleme | Başarılı (debug ~5 MB, release ~1,4 MB, R8 küçültmeli) |
| G | APK doğrulama (`apksigner verify`, `aapt2 dump badging`) | İmza geçerli; paket `space.orbitragame.app`, minSdk 24, targetSdk 36, simge/etiket doğru |

### C testinin ayrıntısı (betik oyunu bozuyor mu?)

| Kontrol | Sonuç |
|---|---|
| Oyun FPS'i betik olmadan / betikle | 59,9 / 60,0 — fark yok |
| Betiğin ölçtüğü oyun FPS'i gerçek değere yakın (±%10) | 60,0 (gerçek 60,0) |
| WebSocket yankı (echo) trafiği betikli ve betiksiz aynı | Evet |
| `instanceof WebSocket`, `WebSocket.OPEN`, WebSocket alt sınıfı | Korunuyor |
| `requestAnimationFrame` kimliği ve `cancelAnimationFrame` | Korunuyor |
| Soket açıldı / kapandı (+ kapanma kodu) bildirimi | Doğru |
| Tarayıcı FPS'i ve "oyun hazır" sinyali | Doğru |
| Sayfa hatası | Yok |

### Bu testlerde bulunup düzeltilen gerçek hatalar

- Bazı WebView sürümlerinde desteklenmeyen isteğe bağlı ayarlar uygulamayı
  çökertebiliyordu → artık güvenle atlanıyor.
- Ekran yenileme hızını okuyan kod bazı durumlarda istisna fırlatıyordu → düzeltildi.
- Ekran kapandıktan sonra gelen ping sonucu kapanmış ekrana yazmaya çalışıyordu → düzeltildi.
- Yatay ekranda açılış ekranındaki durum satırı ekrandan taşıyordu → düzeltildi.

## İstenen 15 test — durum ve telefonda nasıl yapılır

| # | Test | Burada | Telefonda nasıl test edilir |
|---|---|---|---|
| 1 | Oyun doğru açılıyor mu? | Kısmen: uygulama açılışı ve yükleme akışı (B), giriş sayfası (D) | Uygulamayı aç; açılış ekranı yüzdesi ilerlemeli, giriş sayfası veya oyun açılmalı. |
| 2 | Kullanıcı giriş yapabiliyor mu? | **Yapılamadı** (hesap yok) | Kullanıcı adı, şifre, doğrulama kodu ile giriş yap; "Beni hatırla"yı seç; uygulamayı kapatıp aç → doğrudan oyuna girmeli. |
| 3 | Sunucu bağlantısı korunuyor mu? | Mantık birim testli (A); gerçek sunucu **test edilemedi** | Menü → Ping'i aç; "Sunucu: Bağlı" görünmeli. 10 dk oyna. |
| 4 | WebSocket çalışıyor mu? | Test oyununda doğrulandı (C) | Panelde "Sunucu: Bağlı (n)" ve oyunun canlı hareketi. |
| 5 | Oyun içi sohbet çalışıyor mu? | **Yapılamadı** | Sohbete yaz; klavye açılınca yazı alanı görünür kalmalı. |
| 6 | FPS göstergesi doğru mu? | Test oyununda ±%10 içinde doğru (C) | Menü → FPS. "FPS", "Tarayıcı", "Ekran" değerleri; ağır sahnede düşüş ve gerekiyorsa "DÜŞÜK FPS" uyarısı. |
| 7 | Ping ölçümü çalışıyor mu? | İstatistik testli (A); gerçek ağ **cihazda** | Menü → Ping. Wi-Fi'de tipik 20–80 ms; uçak modunda "kayıp" artmalı. |
| 8 | Dikey ve yatay ekran | Açılış ekranı her iki yönde çizildi (B) | Menü → Dikey / Yatay / Otomatik; oyun yeniden yüklenmeden yeniden boyutlanmalı. |
| 9 | Tam ekran | **Cihazda** | Menü → Tam ekran; durum ve gezinme çubukları gizlenmeli, kenardan kaydırınca geçici görünmeli. |
| 10 | Küçük pencere modu | **Cihazda** (Robolectric PiP desteklemez) | Ana ekran tuşu → oyun köşede küçük pencerede devam etmeli; sürükle, iki parmakla boyutlandır, dokun → genişlet. |
| 11 | Arka plana alındığında bağlantı | **Cihazda** | PiP'i kapat (Ayarlar → otomatik küçük pencere kapalı), ana ekrana dön, 1–5–15 dk bekle, geri dön; panelde sunucu durumunu kontrol et. |
| 12 | Dönünce oyun devam ediyor mu? | Yeniden yükleme yapılmadığı kod ve yaşam döngüsü testiyle doğrulandı (B) | Arka plandan dön; oyun kaldığı yerden devam etmeli, açılış ekranı tekrar görünmemeli. |
| 13 | Zoom oyun kontrollerini bozuyor mu? | **Cihazda** | Menü → Yakınlaştır/Uzaklaştır/İki parmak; ardından oyunda dokunma ve iki parmak hareketlerini dene. |
| 14 | Uzun kullanımda bellek | **Cihazda** | Paneli aç, 1 saat oyna; "Uyg MB" ve "JS MB" sürekli artmamalı. |
| 15 | Farklı telefonlarda performans | **Cihazda** | En az bir düşük, bir orta seviye cihazda FPS ve ısınmayı karşılaştır. |

## Bilinen sınırlamalar (bilerek yapılmış tercihler)

- **Arka planda süreklilik garanti değil.** Android ve üreticiler arka plandaki
  uygulamayı kısıtlayabilir. En güvenli yol otomatik küçük penceredir.
- **Ping**, oyun soketinin bağlandığı sunucuya **TCP el sıkışma süresidir.**
  Site Cloudflare arkasında olduğu için bu, ağ geçidine (edge) kadar olan
  gecikmedir; oyun sunucusunun kendi işlem süresini içermez. Oyunun soket
  trafiğine bilerek ek paket gönderilmez.
- **Oyun FPS**, oyunun `requestAnimationFrame` döngüsünün saniyedeki kare
  sayısıdır. Oyun bu döngünün içinde kendi kare atlaması yapıyorsa gerçekte
  çizilen kare sayısı daha düşük olabilir. Oyun `requestAnimationFrame`
  kullanmıyorsa "FPS —" görünür.
- **Uygulama zoom'u** sayfaya farklı bir görüş alanı boyutu bildirir (oyun
  döndürmedeki gibi yeniden boyutlanır). Oyunun koordinatları ve WebGL'i
  bozulmaz; yakınlaştırmada görüntü biraz yumuşayabilir.
- **Sesli iletişim:** Uygulama mikrofon iznini oyun isterse ve sen onaylarsan
  verir. Ancak sitenin incelenen sayfalarında `Permissions-Policy:
  microphone=()` başlığı var; yani mikrofonu site tarafı kapatmış olabilir.
- **Arka planda ses:** Bağlantı koruma açıkken oyun sesleri arka planda da
  duyulabilir (sesi oyunun kendi ayarından kapatabilirsin).
- **Küçük pencere boyutu** Android tarafından yönetilir; uygulama en küçük
  boyutu kendisi belirleyemez. Kullanıcı iki parmakla küçültüp kenara itebilir.
- **Ödeme sayfası** gibi `orbitragame.space` dışındaki sayfalar uygulama içinde
  açılmaz; "Tarayıcıda aç" seçeneği sunulur.
