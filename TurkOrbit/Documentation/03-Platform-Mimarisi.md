# 03 — PC, Web, Android, iOS ve Tablet Ortak Sistem Mimarisi

## 1. Temel karar: tek istemci kod tabanı, tek dünya

```
apps/client  (React + Phaser + TypeScript)
   ├── Web / PWA ............ Windows, Mac, Linux, Chromebook tarayıcıları (kurulabilir PWA)
   ├── Capacitor Android .... APK / AAB (Google Play veya doğrudan APK)
   └── Capacitor iOS ........ Xcode projesi (TestFlight / App Store)
                  │
                  ▼
        AYNI API (apps/api) + AYNI oyun sunucusu (apps/game-server)
        AYNI PostgreSQL  →  aynı hesap, karakter, envanter, ekonomi, klan, sohbet
```

- Platformlar ayrı oyunlar **değildir**. Oyun mantığı sunucudadır, istemci yalnızca girdi toplar ve çizim yapar. Bu yüzden PC oyuncusu ile Android/iOS oyuncusu aynı haritada, aynı NPC'ye karşı, aynı grupta oynar.
- Masaüstü (Windows/Mac) için ilk dağıtım **kurulabilir PWA**'dır (tam ekran, masaüstü simgesi, otomatik güncelleme). Mağaza dağıtımı gerekirse (Steam, Microsoft Store) aynı derleme Aşama 15'te Tauri/Electron sarmalayıcısıyla paketlenir.

## 2. Ortak hesap (Aşama 1'de uygulandı)

| Platform | Oturum taşıma | Saklama | CSRF |
|---|---|---|---|
| Web / PWA | `__Host-to_sid` çerezi (HttpOnly, Secure, SameSite=Strict) | Tarayıcı, JS erişemez | `X-CSRF-Token` + Origin denetimi |
| Android (Capacitor) | `Authorization: Bearer <anahtar>` (`transport: "token"`) | Android Keystore (güvenli depolama eklentisi) | Gerekmez (tarayıcı otomatik eklemez) |
| iOS (Capacitor) | `Authorization: Bearer <anahtar>` | iOS Keychain | Gerekmez |
| Masaüstü sarmalayıcı | Bearer | İşletim sistemi anahtar zinciri | Gerekmez |

- Her oturum `platform`, cihaz adı ve uygulama sürümüyle kaydedilir. Kullanıcı "Hesap güvenliği" ekranında tüm cihazlarını görür ve herhangi birini uzaktan kapatabilir. Bu akış uçtan uca testte doğrulandı: PC'den kapatılan Android oturumu anında geçersiz oldu.
- Bir platformda yapılan her değişiklik (seviye, envanter, para, görev, klan) doğrudan sunucuya yazıldığı için diğer platformlarda da aynen görünür. İstemcide oyun verisi önbelleği yalnızca görüntüleme amaçlıdır.

## 3. Girdi soyutlama katmanı (Aşama 7)

Tüm kontrol yöntemleri aynı **niyet** nesnelerine çevrilir. Oyun sunucusu hangi cihazdan geldiğini bilmek zorunda değildir.

```ts
type Intent =
  | { kind: 'moveTo'; x: number; y: number }      // fare tıklaması / dokunma / joystick yönü
  | { kind: 'stop' }
  | { kind: 'selectTarget'; entityId: number }      // tıklama / dokunma / otomatik hedef
  | { kind: 'fire'; on: boolean }                  // CTRL/boşluk tuşu / ateş butonu
  | { kind: 'useAmmo'; slot: number }              // 1-9 tuşları / hızlı çubuk
  | { kind: 'useRocket' } | { kind: 'switchLoadout' } | { kind: 'portalJump' };
```

| Kontrol | PC | Mobil / Tablet |
|---|---|---|
| Hareket | Fare ile tıkla-git, isteğe bağlı WASD | Sanal joystick **veya** dokun-git (oyuncu seçer) |
| Hedef | Fare ile tıklama, TAB ile en yakın hedef | Dokunarak seçim, "otomatik hedef" düğmesi |
| Lazer / roket | CTRL / boşluk, 1-9, R | Büyük ateş ve roket düğmeleri |
| Konfigürasyon değiştir | C | Tek dokunuşla hızlı değişim düğmesi |
| Yakınlaştırma | Fare tekerleği | İki parmakla yakınlaştırma |
| Sohbet, grup, menü | Kısayollar + paneller | Açılır-kapanır çekmece paneller |
| Özelleştirme | Tuş atamaları | Düğme konumu, boyutu ve şeffaflığı (sürükle-bırak düzenleme modu) |

Ayarlar `player_settings` tablosunda **cihaz sınıfına göre** (masaüstü/telefon/tablet) tutulur ve aynı sınıftaki tüm cihazlarda senkronize olur.

## 4. Ekran uyumluluğu ve HUD

- **Yerleşim profilleri:** `desktop` (≥1024 px, yatay), `tablet` (768–1366 px, dokunmatik), `phone-landscape`, `phone-portrait` (menüler için; oyun alanında yatay mod önerilir).
- **Güvenli alanlar:** `env(safe-area-inset-*)` ile çentik ve yuvarlak köşeler korunur (hesap ekranlarında uygulandı).
- **HUD ölçeği:** 0.75–1.5 arası kullanıcı ayarı. Yazı boyutu minimum 14 px, dokunma hedefi minimum 44×44 px (hesap ekranlarında uygulandı).
- **Mini harita kuralları:** NPC'ler varsayılan olarak mini haritada sürekli gösterilmez. Kargo kutuları ve düşmanlar yalnızca algılama mesafesindeyse gösterilir. Sunucu AOI filtresi zaten bu bilgiyi göndermediği için hile ile de görülemez.
- Mobilde paneller oyun alanını kaplamaz. Grup, sohbet ve görev panelleri kenar çekmecesi olarak açılır.

## 5. Mobil performans planı

| Ayar | Düşük | Orta | Yüksek |
|---|---|---|---|
| Hedef FPS | 30 | 60 | 60 / 120 (destekleyen ekran) |
| Çözünürlük ölçeği | 0.6× | 0.85× | 1× (DPR ≤ 2) |
| Parçacık sayısı | %25 | %60 | %100 |
| Arka plan katmanı | statik | 2 katman paralaks | 3 katman + bulutsu |
| Patlama efekti | sprite | sprite + ışıma | tam |

- İlk açılışta kısa bir performans ölçümü yapılır ve kademe otomatik seçilir. Oyuncu ayarı değiştirebilir.
- Sprite atlasları ve nesne havuzları kullanılır (çöp toplama takılmalarını önler). Sekme arka plandayken çizim durdurulur.
- Ağ tarafında ikili protokol, delta sıkıştırma ve AOI filtresi kullanılır. Hedef bant genişliği yoğun haritada oyuncu başına ≤ 15 KB/s'dir.

## 6. Sürüm yönetimi (Yönetim Merkezi 16.7)

- İstemci her istekte `X-Client-Platform` ve `X-Client-Version` gönderir.
- `client_releases` tablosundaki **minimum desteklenen sürümün** altındaki istemcilere API `426 Upgrade Required` döner ve ilgili mağaza bağlantısı gösterilir.
- Platform bazlı oyuncu sayısı, cihaz/işletim sistemi dağılımı ve hata raporları (`client_error_reports`) Yönetim Merkezi'nde gösterilir.

## 7. Derleme ve dağıtım (Aşama 15)

| Hedef | Nasıl | Gereksinim |
|---|---|---|
| Web/PWA | `npm run build -w @turkorbit/client` → `apps/client/dist` → nginx | Linux sunucu |
| Android APK/AAB | `npx cap sync android` → `./gradlew assembleRelease bundleRelease` (GitHub Actions'ta da çalışır) | JDK 17, Android SDK, imzalama anahtarı (keystore) |
| iOS | `npx cap sync ios` → Xcode → Archive | **macOS + Xcode**, **Apple Developer Program üyeliği (yıllık ücretli)**, sertifika + provisioning profile. TestFlight ve App Store için zorunludur. |
| Masaüstü (isteğe bağlı) | Tauri/Electron paketleme | Windows için kod imzalama sertifikası önerilir |

## 8. Gerçek cihaz test matrisi (Aşama 15-16)

| Senaryo | Cihazlar | Ölçüt |
|---|---|---|
| PC ↔ Android aynı harita | Windows Chrome + orta seviye Android | Karşılıklı hareket ≤ 150 ms görünür gecikme |
| PC ↔ iOS | Mac Safari + iPhone | Aynı NPC'ye ortak saldırı, ödülün doğru dağıtımı |
| Android ↔ Android, iOS ↔ iOS | 2+ cihaz | Grup, sohbet, harita geçişi |
| Telefon ve tablet ekranları | 5.5", 6.7", 11" | HUD kesilmiyor, dokunma alanları ≥ 44 px |
| Bağlantı kopması | Wi-Fi ↔ mobil veri geçişi | 30 sn içinde kayıpsız yeniden bağlanma |
| Uzun oyun | 60 dk | Bellek artışı < %10, FPS düşüşü yok, pil tüketimi ölçümü |

> **Not:** Bu oturumda gerçek telefon/tablet ve macOS bulunmadığından mobil yalnızca **tarayıcı emülasyonuyla** (Chromium "iPhone 13" profili) test edildi. Gerçek cihaz testleri yapılmış gibi raporlanmamıştır.
