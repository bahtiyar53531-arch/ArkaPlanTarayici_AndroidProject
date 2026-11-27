# 06 — Klasör Yapısı

```
ArkaPlanTarayici_AndroidProject/          (depo kökü — eski APK projesi, dokunulmadı)
└── TurkOrbit/                            ← Türk Orbit monorepo kökü
    ├── package.json                      npm workspaces + kök komutlar
    ├── tsconfig.base.json                ortak TypeScript ayarları
    ├── .env.example                      örnek ortam değişkenleri (.env olarak kopyalanır)
    ├── docker-compose.yml                yerel PostgreSQL 16 + Redis 7 + Mailpit
    ├── README.md                         hızlı başlangıç
    │
    ├── packages/
    │   └── shared/                       @turkorbit/shared — istemci + sunucu ortak kodu
    │       └── src/
    │           ├── brand.ts              marka sabitleri, platform listesi
    │           ├── roles.ts              rol/yetki kataloğu (DB tohumuyla birebir)
    │           ├── password-policy.ts    parola politikası (istemci + sunucu)
    │           ├── auth-schemas.ts       zod doğrulama şemaları
    │           ├── api-types.ts          API yanıt tipleri, hata kodları
    │           ├── labels.ts             Türkçe etiketler
    │           ├── progression.ts        seviye eğrisi ve rütbe puanı (Aşama 5)
    │           ├── player.ts             profil şemaları ve tipleri (Aşama 5)
    │           ├── items.ts              eşya şemaları, slot kuralları, konfigürasyon istatistikleri (Aşama 6)
    │           └── shared.test.ts
    │
    ├── apps/
    │   ├── api/                          @turkorbit/api — REST API (Fastify)
    │   │   ├── src/
    │   │   │   ├── index.ts              sunucu giriş noktası
    │   │   │   ├── app.ts                Fastify kurulumu, güvenlik katmanları, hata işleyici
    │   │   │   ├── runtime.ts            PostgreSQL/Redis/e-posta/hız sınırı bağımlılıkları
    │   │   │   ├── config/env.ts         ortam değişkeni doğrulama
    │   │   │   ├── db/                   bağlantı havuzu, migration çalıştırıcı
    │   │   │   ├── lib/                  crypto, Argon2id, e-posta, hız sınırı, cihaz bilgisi, hatalar
    │   │   │   ├── modules/
    │   │   │   │   ├── auth/             kayıt, giriş, oturum, parola, güvenlik (Aşama 1)
    │   │   │   │   ├── player/           pilot oluşturma, profil, şirket değişimi, açık profil (Aşama 5)
    │   │   │   │   ├── economy/          cüzdan ve envanter çekirdeği: kilit + defter + idempotency (Aşama 5-6)
    │   │   │   │   ├── hangar/           hangar, ekipman, yükseltme, tamir, PET, mağaza (Aşama 6)
    │   │   │   │   ├── world/            galaksi, harita, geçit kuralları, oyuncu ayarları (Aşama 7)
    │   │   │   │   ├── game/             oyun bileti + Redis köprüsü: çevrimiçi durum, tek oturum, canlı değişiklik (Aşama 8)
    │   │   │   │   └── health/           sağlık uç noktası
    │   │   │   ├── game/                 gerçek zamanlı oyun sunucusu — AYRI SÜREÇ (npm run dev:game): WebSocket, 20 Hz simülasyon, AOI (Aşama 8)
    │   │   │   └── scripts/              migrate.ts, role-cli.ts (sunucu tarafı rol atama)
    │   │   └── test/                     entegrasyon testleri (gerçek PostgreSQL + Redis)
    │   │
    │   ├── client/                       @turkorbit/client — oyun istemcisi (web/PWA, Aşama 15'te Android/iOS)
    │   │   ├── index.html, vite.config.ts
    │   │   ├── public/                   favicon.svg (logo), manifest.webmanifest
    │   │   └── src/
    │   │       ├── api/client.ts         API istemcisi (CSRF, hata yönetimi)
    │   │       ├── auth/AuthContext.tsx  oturum durumu
    │   │       ├── components/           Layout, form bileşenleri, parola gücü göstergesi
    │   │       ├── pages/                giriş, kayıt, doğrulama, şifre sıfırlama, hesap, güvenlik, pilot, hangar, mağaza, oyun
    │   │       ├── game/                 Phaser sahnesi, ağ kontrolcüsü (tahmin/uzlaştırma/enterpolasyon), dokular (Aşama 7-8)
    │   │       ├── components/game/      HUD: pilot paneli, mini harita, radar listesi, galaksi, joystick, ayarlar, bağlantı durumu
    │   │       └── styles/               global.css (koyu uzay teması), game.css (oyun ekranı)
    │   │
    │   └── admin/                        (Aşama 14) TÜRK ORBIT YÖNETİM MERKEZİ — şimdilik README
    │
    ├── database/
    │   ├── migrations/                   0001_auth, 0002_player_profile, 0003_hangar, 0004_world (numaralı, değiştirilmez)
    │   └── schema-draft.sql              tüm oyunun doğrulanmış taslak şeması
    │
    ├── infra/
    │   ├── nginx/turkorbit.conf.example  üretim nginx örneği
    │   └── postgres/init-test-db.sql     docker ilk açılışında test veritabanları
    │
    ├── scripts/
    │   ├── e2e-auth.mjs                  API uçtan uca testi (gerçek sunucu + gerçek SMTP, 2 hesap)
    │   ├── ui-e2e.mjs                    tarayıcı testi (masaüstü + iPhone görünümü, ekran görüntüsü)
    │   └── package-phase.mjs             aşama ZIP teslimatı üretici
    │
    ├── Documentation/                    tasarım belgeleri (00–08), aşama klasörleri
    │   ├── Asama-01-Kayit-Giris/         API referansı, kurulum ve dosya yerleştirme rehberi
    │   ├── Asama-05-Oyuncu-Profili/      API referansı, güncelleme rehberi
    │   ├── Asama-06-Hangar-Ekipman/      API referansı, güncelleme rehberi
    │   ├── Asama-07-Harita-Oyun-Motoru/  API referansı, güncelleme rehberi
    │   ├── Asama-08-Multiplayer/         ağ protokolü, güncelleme ve sunucu kurulum rehberi
    │   └── DevelopmentNotes/             aşama raporları, karar günlüğü, ekran görüntüleri
    │
    └── Deliveries/                       aşama ZIP paketleri
```

**Aşama 15'te eklenecek:** `apps/client/android/` ve `apps/client/ios/` (Capacitor yerel projeleri), `TurkOrbit/.github`'a değil depo köküne, yalnızca `TurkOrbit/**` değişikliklerinde çalışan Android derleme workflow'u.
