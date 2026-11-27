# 00 — Çalışma Klasörü ve Mevcut Altyapı Analizi

**Tarih:** 27.11.2026 · **Depo:** `ArkaPlanTarayici_AndroidProject` · **Dal:** `ccr-4f8cba77-ej0zlw`

## 1. Depoda bulunanlar (Türk Orbit öncesi)

| Dosya / klasör | İçerik | Türk Orbit ile ilişkisi |
|---|---|---|
| `.github/workflows/lbuild-apk.yml` | "ArkaPlan Tarayıcı" adlı WebView tabanlı Android tarayıcı APK'sını GitHub Actions'ta üretip `v1.0` sürümü olarak yayımlıyor. | Yok. |
| `.github/workflows/starkorbit-v2.yml` (~80 KB) | Kotlin kaynakları YAML içine gömülü "StarkOrbit/StarkChrome" tarayıcı APK'sı; v1–v3 sürümlerini silip yeniden oluşturuyor. | Yok. |
| `.github/workflows/starkchrome-v3.yml` | Başka bir workflow'dan kod parçası ayıklayıp "ORBITRAMMO" APK'sı üretiyor, v1–v4 sürümlerini silip v5.0'ı yayımlıyor. | Yok. |
| `starkorbit-v2.yml`, `starkchrome-v3.yml` (kök), `starkchrome-v.github/…` | Yukarıdaki workflow'ların kopyaları. | Yok. |
| `BackgroundBrowserApp.kt` | Boş dosya (1 bayt). | Yok. |

**Sonuç:** Depoda Türk Orbit'e ait hiçbir kaynak kod, veritabanı, backend veya oyun dosyası **yoktu**. Mevcut içerik, üçüncü taraf bir oyun sitesini açan WebView tarayıcı/otomasyon APK'larıdır. Bu dosyalara dokunulmadı.

## 2. Önemli tespit: workflow'lar her push'ta çalışıyor

Üç workflow da `on: push` ile **dal filtresi olmadan** tetikleniyor. Bu yüzden herhangi bir dala yapılan her push:

- GitHub'daki `v1.0`–`v4.0` sürümlerini **siliyor** ve yeniden oluşturuyor,
- üç ayrı APK derlemesini aynı anda başlatıyor (birbirinin sürümünü silen yarış durumu oluşuyor).

Türk Orbit commit'leri bu sürümleri gereksiz yere silip yeniden oluşturmasın diye commit mesajlarına **`[skip ci]`** eklendi (GitHub Actions bu işareti görünce push tetikleyicili workflow'ları çalıştırmaz). Mevcut workflow dosyaları değiştirilmedi.

> **Öneri (senin kararın):** Türk Orbit'i ayrı bir depoya taşımak veya eski workflow'lara `paths-ignore: ['TurkOrbit/**']` eklemek. Aşama 15'te Türk Orbit'in kendi Android/iOS derleme workflow'u yalnızca `TurkOrbit/**` değişikliklerinde çalışacak şekilde eklenecek.

## 3. Çalışma ortamı (bu geliştirme oturumu)

| Bileşen | Sürüm | Not |
|---|---|---|
| Ubuntu | 24.04 | Hedef sunucu işletim sistemiyle aynı |
| Node.js | 22.23 | LTS |
| PostgreSQL | 16.15 | Testler gerçek veritabanında çalıştı |
| Redis | 7.x (`redis-server`) | Hız sınırlama + oturum önbelleği testleri gerçek Redis'te |
| Java / Gradle | 17 / 8.x | Aşama 15 (Android) için hazır |
| Chromium + Playwright | — | Arayüz testleri ve ekran görüntüleri |
| Xcode / macOS | **yok** | iOS derlemesi bu ortamda yapılamaz (Aşama 15'te macOS gerekir) |
| Gerçek telefon/tablet | **yok** | Gerçek cihaz testleri yapılmadı; mobil görünüm yalnızca tarayıcı emülasyonuyla denendi |

## 4. Kararlar

- Türk Orbit, depo kökünde ayrı bir **`TurkOrbit/`** klasöründe monorepo olarak kuruldu (eski APK projesiyle karışmaması için).
- Geliştirme notları `TurkOrbit/Documentation/DevelopmentNotes/` klasöründe tutulur.
- Teslimat ZIP'leri `TurkOrbit/Deliveries/` klasöründedir.
