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
