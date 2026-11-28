# Aşama 14 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-14-Yonetim-Merkezi.zip`) **Aşama 1–13'ü de içeren tam projedir**. İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak. Bu rehber, Aşama 13 kurulu bir sistemi günceller.

> **Önemli:**
> - **Yeni migration:** `0010_admin.sql`. Yaptırımlar, içerik sürümleri, onay talepleri, `maintenance` ve `admin` ayarlarını ekler. Başlatmadan önce `npm run db:migrate` çalıştır.
> - **Yeni uygulama:** `apps/admin` (Yönetim Merkezi). Yeni bir npm çalışma alanıdır. `npm install` onu bağlar; `npm run build` onu da derler (`apps/admin/dist`).
> - Yeni dış bağımlılık **yok**: React, React Router ve Vite istemcinin kullandığı sürümlerdir.
> - Yeni ortam değişkeni **yok**. Geliştirmede panelin adresi `ALLOWED_ORIGINS`'e eklenmeli (`.env.example` güncellendi: `http://localhost:5175`).

## 1. Dosyaları yerleştirme
1. API'yi, oyun sunucusunu ve istemciyi durdur.
2. Veritabanını yedekle: `pg_dump -Fc turkorbit > turkorbit-asama13.dump`.
3. ZIP'i aç ve `TurkOrbit/` üzerine kopyala.
4. `npm install`, `npm run db:migrate` (`✔ uygulandı: 0010_admin.sql`) ve `npm run build` çalıştır.
5. Paneli yayımla: `apps/admin/dist/` içeriğini `/var/www/turkorbit/admin/` klasörüne kopyala.
6. nginx'e `location /yonetim/` bloğunu ekle (bkz. `infra/nginx/turkorbit.conf.example`).
7. Hizmetleri başlat. **Önce API, sonra oyun sunucusu:** oyun sunucusu bakım durumunu açılışta okur.

| Yeni / değişen dosya | Ne |
|---|---|
| `database/migrations/0010_admin.sql` | **Yeni:** `sanctions`, `content_revisions`, `approval_requests`, ayarlar |
| `packages/shared/src/admin.ts` | **Yeni:** şemalar, içerik türleri ve alan tanımları, ayar kayıtları, fark ve doğrulama, görünüm tipleri |
| `apps/api/src/modules/admin/` | **Yeni:** rota tablosu, oyuncu, içerik, onay, pano/sistem/şikâyet/denetim servisleri |
| `apps/api/src/game/server.ts` | `game:admin` olayları (canlı içerik, atma, susturma, bakım, duyuru), nabız |
| `apps/api/src/modules/{game/bridge,game/routes,auth/service,forum/service,quest/service}.ts`, `app.ts` | Yönetim kanalı ve nabız anahtarları, bakımda bilet engeli, tüm oturumları iptal, forumda susturma, görev önbelleği sürüm denetimi, bağlantılar |
| `apps/admin/` | **Yeni:** Yönetim Merkezi arayüzü |
| `apps/client/src/{game/controller.ts, components/game/GameHud.tsx, styles/game.css}` | Gerekçeli atma/bakım mesajı, hedef panelinde NPC azami canı, üst üste dizilen bildirimler |
| `infra/nginx/turkorbit.conf.example` | `/yonetim/` konumu |
| `package.json`, `package-lock.json`, `.env.example` | Çalışma alanı, `dev:admin`, izinli kaynak |

## 2. İlk Süper Yönetici ve personel
Yönetici yetkisi API'den veya kayıt formundan **verilemez**. İlk Süper Yönetici sunucuda araçla atanır:

```bash
npm run admin:grant-role -- --user <kullanıcıadı> --role super_admin --reason "İlk kurulum"
```

- **Diğer personel:** Panelde Oyuncular → kişi → Roller bölümünden atanır (`roles.assign`).
- **Rütbe kuralı:** Kimse kendi rütbesine eşit veya yüksek bir rolü atayamaz.
- **Yeni Süper Yönetici:** Panelden atanması ikinci bir Süper Yöneticinin onayını ister. Tek Süper Yönetici varsa ikincisi yine araçla atanır.
- **Önerilen ilk düzen:**

| Kişi | Rol |
|---|---|
| Kurucu | Süper Yönetici (2 kişi, onay için) |
| Teknik | Sistem Yöneticisi |
| Oyun dengesi | Oyun Yöneticisi / İçerik Yöneticisi |
| Topluluk | Topluluk Yöneticisi, Moderatör |
| Destek | Destek Personeli |

## 3. Geliştirme ortamında çalıştırma
```bash
npm run dev:api      # 4000
npm run dev:game     # 4001
npm run dev:client   # 5173 (oyun)
npm run dev:admin    # 5175 → http://localhost:5175/yonetim/
```

Panelde oyuncu hesabıyla giriş yapılır; rolü yoksa "Yetkin yok" görünür. Aynı tarayıcıda oyuna (5173) girmişsen oturum panelde de geçerlidir.

## 4. Deneme senaryosu (iki hesap)
1. **NPC:** Oyuncu hesabıyla oyuna gir ve bir NPC'yi hedefle (hedef panelinde "400 / 400" gibi azami can görünür). Yönetici hesabıyla İçerik → NPC türleri → aynı NPC → Can'ı değiştir → **Taslak olarak kaydet** → farkı gör → **Yayınla**. Oyuncunun hedef panelinde yeni azami can görünür.
2. **Mağaza:** İçerik → Mağaza → ürün → Fiyat → yayınla. Oyuncu mağazayı yenileyince yeni fiyatı görür. Sürüm geçmişinde "Bu sürüme dön" ile eski fiyat geri gelir.
3. **Görev:** İçerik → Görevler → **Yeni etkinlik görevi** → oluştur (oyuncu görmez) → "Yayında: Evet" → taslak → yayınla. Oyuncunun Görevler → Etkinlik sekmesinde görünür.
4. **İki yetkili onayı:** Ekonomi → oyuncunun pilotu → 2.000.000 Kredi → "Onaya gönder". Aynı kişi onaylayamaz; ikinci bir Oyun Yöneticisi **Onay bekleyenler**'den onaylar.
5. **Yaptırım:** Oyuncular → kişi → **Askıya al**. Oyundaki bağlantı gerekçeyle hemen kapanır; giriş reddedilir. **Banı kaldır** ile açılır.
6. **Bakım:** Sistem → mesaj → **Bakım modunu aç**. Oyuncu oyundan çıkarılır, personel kalır. **Bakımı bitir**.

## 5. Güvenlik notları
- **Yetki denetimi:** Panel arayüzü yetkiyi yalnızca menüyü gizlemek için kullanır. Her uç sunucuda yetki denetler; `npm test` her uç için 401/403 testini çalıştırır.
- **İsteğe bağlı erişim kısıtı:** nginx'te `/yonetim/` için IP kısıtı (ofis/VPN) eklenebilir. Bu, sunucu tarafı denetimin yerine geçmez, onu tamamlar.
- **Denetim kaydı:** Değiştirilemez ve silinemez. Yönetici hesabı silinse de kayıtta adı kalır.

## 6. Testler
```bash
npm test            # birim + entegrasyon: 403 matrisi (her uç), yaptırımlar, yayın/geri alma, iyimser kilit, iki yetkili onayı, canlı NPC (gerçek WebSocket)
npm run test:e2e    # API uçtan uca: süreçler arası canlı NPC yansıması ve askıda anında atma
npm run test:ui     # tarayıcı: yönetici + oyuncu + ikinci yetkili; NPC canı, fiyat, görev, onay, askı, bakım, denetim kaydı, telefonda panel
```
