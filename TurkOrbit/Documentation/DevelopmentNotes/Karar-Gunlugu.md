# Karar Günlüğü

Her önemli mimari kararın neden alındığını ve hangi seçeneklerin elendiğini kayıt altına alır.

| # | Tarih | Karar | Gerekçe | Elenen seçenek |
|---|---|---|---|---|
| K-001 | 27.11.2026 | Türk Orbit depo kökünde `TurkOrbit/` klasöründe monorepo | Depodaki eski APK projesiyle karışmasın | Depo köküne yaymak |
| K-002 | 27.11.2026 | Commit mesajlarında `[skip ci]` | Eski workflow'lar her push'ta GitHub sürümlerini siliyor | Eski workflow dosyalarını izinsiz değiştirmek |
| K-003 | 27.11.2026 | TypeScript + Fastify + ham SQL (`pg`) | Ekonomi/envanterde kilit ve kısıt kontrolü açık olmalı; tip paylaşımı | Express, Prisma/TypeORM |
| K-004 | 27.11.2026 | Opak oturum anahtarı + SHA-256 (JWT yok) | Anında iptal (ban, parola değişimi, cihaz kapatma) | JWT erişim/yenileme anahtarı |
| K-005 | 27.11.2026 | Web: `__Host-` çerez + SameSite=Strict; uygulama: Bearer | Capacitor uygulamaları farklı origin'den çalışır, iOS üçüncü taraf çerezlerini kısıtlar | Her yerde çerez / her yerde Bearer |
| K-006 | 27.11.2026 | CSRF: yalnızca JSON + Origin + oturuma bağlı HMAC anahtar | Derinlemesine savunma; anahtar saklama gerektirmez | Çift gönderimli çerez |
| K-007 | 27.11.2026 | Varsayılan `player` rolü veritabanı tetikleyicisinde | Uygulama kodunda hata olsa bile kural bozulmaz | Yalnızca uygulama kodunda atama |
| K-008 | 27.11.2026 | İlk yönetici yalnızca sunucu tarafı CLI ile | "Kimse kendini yönetici yapamaz" kuralı; SSH + DB erişimi gerektirir | Kurulum sihirbazı / gizli API |
| K-009 | 27.11.2026 | Kayıtlı e-posta ile kayıtta aynı yanıt + sahibine bilgi e-postası | Hesap varlığı sızmaz | "Bu e-posta kayıtlı" hatası |
| K-010 | 27.11.2026 | Kayıttan sonra otomatik giriş yok | Otomatik giriş, e-postanın kayıtlı olup olmadığını ele verirdi | Kayıt sonrası oturum açma |
| K-011 | 27.11.2026 | Doğrulanmamış hesap giriş yapabilir, oyun dünyasına giremez | Kullanıcı doğrulama e-postasını yeniden isteyebilsin; oyun bileti Aşama 8'de doğrulama şartı koyacak | Doğrulamadan girişi tamamen engellemek |
| K-012 | 27.11.2026 | Hatalı giriş kilidi hesap veya denenen ad başına (Redis) | Var olan/olmayan hesap aynı davranır; kullanıcı adı ↔ e-posta değiştirerek kilit aşılamaz | IP başına kilit (paylaşılan IP'lerde masumları cezalandırır) |
| K-013 | 27.11.2026 | Parola politikası NIST yaklaşımı (uzunluk + yasaklı liste + bağlamsal kontrol) | Kullanılabilirlik + güvenlik dengesi | Zorunlu karmaşık karakter kuralları |
| K-014 | 27.11.2026 | Tek istemci kod tabanı + Capacitor | PC/web/Android/iOS aynı oyun, aynı protokol | Ayrı yerel uygulamalar (Unity/Flutter) |
| K-015 | 27.11.2026 | Oyun sunucusu ayrı süreç (`apps/game-server`), API ile aynı DB/Redis | Harita yükü yatay ölçeklenir; mikroservis karmaşası yok | Tek süreç / çok sayıda mikroservis |
| K-016 | 27.11.2026 | İçerik sürümleme (`content_revisions`) + Redis pub/sub ile sıcak yenileme | "Yönetim panelindeki her değer gerçekten oyuna yansımalı" kuralı | Yeniden başlatmayla yükleme |
| K-017 | 27.11.2026 | Para/eşya için yalnızca eklenebilir defter + `idempotency_key` | Çift harcama ve sahte ödüle karşı denetlenebilirlik | Yalnızca bakiye sütunu |
| K-018 | 27.11.2026 | Geliştirme araçları güvenlik açıkları nedeniyle vitest 5 ve react-router 7'ye yükseltildi | `npm audit` 0 açık | Açıkları kabul etmek |
| K-019 | 27.11.2026 | Seviye ve rütbe puanı saklanmaz, deneyim/istatistikten hesaplanır | Tek doğruluk kaynağı; formül değişince geçmiş veri tutarlı kalır | `level`, `rank_points` sütunları |
| K-020 | 27.11.2026 | Pilot adı = hesap kullanıcı adı | Kullanıcı adı zaten benzersiz ve taklit kontrolünden geçmiş; platformlar arası kimlik tutarlı | Sunucu başına ayrı pilot adı |
| K-021 | 27.11.2026 | Pilot oluşturmak e-posta doğrulaması ister | Oyun dünyasına giriş; sahte/tek kullanımlık hesap üretimini zorlaştırır | Doğrulamasız pilot |
| K-022 | 27.11.2026 | Cüzdan çekirdeği Aşama 5'te yazıldı (Aşama 11 yerine) | Profil "oyun paraları" gerektiriyor; başlangıç paraları ilk günden defterli olsun | Bakiye sütununu doğrudan yazmak |
| K-023 | 27.11.2026 | Başlangıç gemisi ve haritaların temel kayıtları Aşama 5'te | Profilde "aktif gemi/harita" gerçek veriyle gösterilsin | Aşama 6/7'ye kadar boş bırakmak |
| K-024 | 27.11.2026 | Şirket değişimi: 30 gün bekleme + 2.000 Akçe, ayarlanabilir | Şirketler arası sık geçişle PvP dengesinin bozulmasını önler | Kalıcı seçim / ücretsiz değişim |
| K-025 | 27.11.2026 | Herkese açık profil e-posta, para, konum ve oynama süresi göstermez | Gizlilik + PvP'de taktik bilgi sızmaması | Tüm profili açık göstermek |
| K-026 | 27.11.2026 | Eşya istatistikleri `jsonb` + kategori bazlı zod şeması | Yönetim Merkezi'nden esnek düzenleme; bozuk veri sunucuda reddedilir | Kategori başına ayrı tablolar |
| K-027 | 27.11.2026 | Para/eşya harcayan her istekte istemci `requestId` (UUID) zorunlu | Çift tıklama ve ağ tekrarında işlem iki kez uygulanmaz | Sunucunun tekrarı tahmin etmesi |
| K-028 | 27.11.2026 | Hangar işlemleri oyuncu satırı kilitlenerek sıraya sokulur | Eşzamanlı istekler tutarlı; deadlock riski düşük (tek kilit sırası) | Satır satır kilit |
| K-029 | 27.11.2026 | Bir eşya tek gemide takılı olabilir, aynı geminin iki konfigürasyonunda ortak | Basit ve öngörülebilir kural | Her konfigürasyon için ayrı eşya |
| K-030 | 27.11.2026 | Yükseltme zarı sunucuda kriptografik RNG, sonuç ve şans kayda yazılır | Hile önleme + şikâyet durumunda denetlenebilirlik | İstemci tarafı zar |
| K-031 | 27.11.2026 | Tıkla-seç ekipman arayüzü (sürükle-bırak yerine) | PC ve dokunmatikte aynı, erişilebilir | Yalnızca sürükle-bırak |
| K-032 | 27.11.2026 | Gemi çizimleri parametrik SVG şekil tablosundan | 10 gemi + paletler tek bileşenle; Aşama 7 sprite'ları aynı tanımdan üretilebilir | Ayrı görsel dosyaları |
| K-033 | 27.11.2026 | Oyun motoru Phaser 3.90 (4.x değil) | Kararlı sürüm, geniş belge ve eklenti desteği, WebGL + Canvas yedeği; ayrı parça olarak yalnızca `/oyna` açılınca indirilir | Phaser 4, PixiJS + kendi oyun döngüsü, Three.js |
| K-034 | 27.11.2026 | Aşama 7'de hareket istemcide simüle edilir, konum REST ile ~1 sn'de bir bildirilir ve sunucuda hız denetiminden geçer | Tek oyunculu aşamada WebSocket altyapısı olmadan da hile engellenebilir; reddedilen konum geri çekilir. Aşama 8'de hareket tamamen oyun sunucusuna geçecek (ekran ve kontroller aynı kalacak) | Aşama 7'de doğrulamasız konum kaydı; Aşama 7'de tam WebSocket |
| K-035 | 27.11.2026 | Dokular kodla üretilir (yıldız, bulutsu, istasyon, geçit, asteroit); gemi dokusu Aşama 6 `ShipArt` SVG'sinden | Görsel dosya indirmeden hızlı açılış; telifli görsel riski yok; gemi hangarda ve uzayda aynı görünür | Hazır sprite paketleri |
| K-036 | 27.11.2026 | Oyuncu ayarları hesap + cihaz sınıfı (bilgisayar/telefon/tablet) başına saklanır | Bilgisayardaki tuş ataması telefondaki joystick düzenini bozmaz; aynı sınıftaki her cihazda aynı ayar | Tek ayar seti / yalnızca cihazda (localStorage) |
| K-037 | 27.11.2026 | Kapatılan haritadaki pilot, bağlandığında şirketinin ana haritasına taşınır ve bildirim alır | Bakım sırasında pilot kapalı haritada mahsur kalmaz; geçiş kaydedilir | Girişi tamamen engellemek |
| K-038 | 27.11.2026 | Mini harita yalnızca sabit nesneleri (istasyon, bölgeler, geçitler) ve pilotun kendisini gösterir | Madde 18 algılama kuralları: NPC ve düşmanlar Aşama 8-9'da radar menzili kuralıyla eklenecek | Haritadaki her şeyi göstermek |
