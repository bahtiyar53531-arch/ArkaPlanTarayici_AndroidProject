# Aşama 7 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-07-Harita-Oyun-Motoru.zip`) **Aşama 1–6'yı da içeren tam projedir**. İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak. Bu rehber, Aşama 6 kurulu bir sistemi günceller.

## 1. Dosyaları yerleştirme
1. API'yi ve istemci geliştirme sunucusunu durdur.
2. `TurkOrbit/.env` dosyanı yedekle (ZIP'te `.env` yoktur).
3. ZIP'i aç ve `TurkOrbit/` klasörünün üzerine kopyala.

| Yeni / değişen dosya | Ne |
|---|---|
| `database/migrations/0004_world.sql` | **Yeni migration**: 60 geçit (30 çift yönlü bağlantı), 51 bölge (istasyon, güvenli bölge, kaynak alanı), galaksi koordinatları, geçiş ve reddedilen konum kayıtları, oyuncu ayarları |
| `packages/shared/src/world.ts` | Harita giriş koşulları, hız denetimi, ayar şeması ve varsayılanları (sunucu ve istemci aynı kuralları kullanır) |
| `apps/api/src/modules/world/` | Galaksi, harita, konum doğrulama, geçit, ayar uç noktaları |
| `apps/api/src/modules/hangar/stats.ts` | Aktif geminin sunucu tarafı istatistikleri (hız denetimi bunu kullanır) |
| `apps/client/src/game/` | Phaser sahnesi (`SpaceScene.ts`), kontrolcü/senkronizasyon (`controller.ts`), kodla üretilen dokular (`textures.ts`) |
| `apps/client/src/pages/GamePage.tsx`, `components/game/` | Oyun ekranı, HUD, mini harita, galaksi haritası, sanal joystick, ayarlar paneli |
| `apps/client/src/styles/game.css` | Oyun ekranı stilleri (yalnızca oyun parçasıyla yüklenir) |
| `apps/client/package.json` | **Yeni bağımlılık:** `phaser@3.90.0` |

## 2. Komutlar
```bash
cd TurkOrbit
npm install               # phaser kurulur
npm run db:migrate        # → "✔ uygulandı: 0004_world.sql"
npm run dev:api
npm run dev:client
```

## 3. Deneme
1. Giriş yap → menüde kırmızı **Oyna** bağlantısı veya pilot/hangar sayfasındaki **Uzaya çık** butonu.
2. **Bilgisayar:**
   - Hareket: W A S D veya ok tuşları. Fareyle tıklanan noktaya gemi kendisi gider.
   - Fare tekerleği yakınlaştırır.
   - Bir geçidin yanına gelince alt ortada **Geçit** kutusu çıkar. **J** tuşu ya da **Atla** butonu ile geçilir.
   - **M** galaksi haritasını, **F** tam ekranı açar. **Esc** açık pencereyi kapatır.
3. **Telefon/tablet:**
   - Sol altta sanal joystick görünür. Ayarlardan tarafı, boyutu, şeffaflığı ve yüksekliği değiştirilebilir.
   - Ayarlardan **Dokun-git** moduna geçilebilir.
   - İki parmakla yakınlaştırılır; ＋/－ butonları da vardır.
   - Mini haritaya dokunulan noktaya gemi gider.
4. **Ayarlar** (⚙️) sunucuya kaydedilir. Aynı hesapla başka bir bilgisayardan girildiğinde aynı tuşlar gelir. Telefon ayarları ayrı saklanır.
5. Gemi hızı, hangarda takılı ekipmandan (İtki jeneratörleri) sunucuda hesaplanır. Hangarda jeneratör değiştirince oyunda hız değişir.

## 4. Değerleri değiştirme (Yönetim Merkezi gelene kadar SQL ile)
```sql
-- Haritayı bakıma al: içerideki pilotlar bağlandıklarında şirket ana haritasına taşınır
UPDATE maps SET is_closed = true WHERE code = 'K-5';
-- Bir geçide ek seviye şartı koy
UPDATE map_portals SET requirements = '{"min_level": 10}'
 WHERE map_id = (SELECT id FROM maps WHERE code = 'K-4') AND target_map_id = (SELECT id FROM maps WHERE code = 'K-8');
-- Geçit atlama yarıçapı
UPDATE game_settings SET value = '{"jump_radius": 500}' WHERE key = 'portal';
-- Hız denetimi toleransı (dikkat: çok düşük değer gecikmeli bağlantıda haksız ret üretir)
UPDATE game_settings SET value = '{"tolerance": 1.25, "slack": 300, "max_elapsed_seconds": 10}' WHERE key = 'movement';
```

## 5. Testler
```bash
npm test            # paylaşılan + API entegrasyon testleri (gerçek PostgreSQL + Redis)
npm run test:e2e    # API uçtan uca (iki hesap, dünya adımları dahil)
npm run test:ui     # tarayıcı uçtan uca (Playwright gerekir; masaüstü + iPhone 13 dikey/yatay)
```

## 6. Üretim notları
- Phaser ayrı bir JavaScript parçasıdır (`phaser-*.js`, gzip ~330 KB) ve yalnızca `/oyna` açılınca indirilir. nginx'te `assets/` için uzun süreli önbellek (`Cache-Control: public, max-age=31536000, immutable`) önerilir: dosya adları içerik özetini taşır.
- Oyun ekranı `env(safe-area-inset-*)` kullanır. iPhone çentiği ve Android gezinme çubuğu için `index.html` içindeki `viewport-fit=cover` korunmalıdır.
