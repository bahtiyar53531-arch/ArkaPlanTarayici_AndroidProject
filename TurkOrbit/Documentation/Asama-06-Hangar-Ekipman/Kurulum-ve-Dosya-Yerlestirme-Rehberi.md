# Aşama 6 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-06-Hangar-Ekipman.zip`) **Aşama 1–5'i de içeren tam projedir**. İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak. Bu rehber Aşama 5 kurulu bir sistemi günceller.

## 1. Dosyaları yerleştirme
1. API'yi durdur.
2. `TurkOrbit/.env` dosyanı yedekle (ZIP'te `.env` yoktur).
3. ZIP'i aç ve `TurkOrbit/` klasörünün üzerine kopyala.

| Yeni / değişen dosya | Ne |
|---|---|
| `database/migrations/0003_hangar.sql` | **Yeni migration**: eşya kataloğu, yükseltme tablosu, envanter, eşya defteri, konfigürasyon slotları, PET, mağaza + 9 gemi ve ekipman tohumu |
| `apps/api/src/modules/hangar/` | Hangar, takma/çıkarma, tamir, satış, yükseltme, PET, mağaza |
| `apps/api/src/modules/economy/inventory.ts` | Envanter çekirdeği (eşya verme/düşme + defter) |
| `packages/shared/src/items.ts` | Eşya istatistik şemaları, slot kuralları, konfigürasyon istatistik hesabı |
| `apps/client/src/pages/HangarPages.tsx`, `lib/format.ts`, `components/ShipArt.tsx` | Hangar ve mağaza ekranları, 10 gemi çizimi, eşya simgeleri |

## 2. Komutlar
```bash
cd TurkOrbit
npm install
npm run db:migrate        # → "✔ uygulandı: 0003_hangar.sql"
npm run dev:api
npm run dev:client
```

## 3. Deneme
1. Giriş yap → menüden **Hangar**. Mevcut pilotların başlangıç ekipmanı hangar ilk açıldığında otomatik verilir ve takılır.
2. Bir slota tıkla → uygun eşyalar listelenir → **Tak / Çıkar**. Sağdaki değerler sunucudan anında güncellenir.
3. **Mağaza** → kategori seç → **Satın al → Onayla**.
4. Envanterde **Yükselt** (şans ve ücret gösterilir) veya **Sat**.

## 4. Değerleri değiştirme (Yönetim Merkezi gelene kadar SQL ile)
```sql
-- OK-1 lazerin hasarını artır (hangar değerlerine anında yansır)
UPDATE item_types SET stats = '{"damage": 45, "rateMs": 1000, "range": 600}' WHERE code = 'laser.ok1';
-- Doğan gemisinde %20 indirim
UPDATE shop_offers SET discount_percent = 20 WHERE ship_type_id = (SELECT id FROM ship_types WHERE code = 'dogan');
-- Tamir ücretini yarıya indir
UPDATE game_settings SET value = '{"currency": "KREDI", "per_1000_hp": 125}' WHERE key = 'repair';
```
> ⚠️ `item_types.stats` alanı kategori şemasına uymazsa (ör. eksik veya negatif değer) sunucu o veriyi kullanmaz ve hata verir. Aşama 14'te Yönetim Merkezi bu doğrulamayı kaydetmeden önce yapacak.

## 5. Testler
```bash
npm test            # 31 paylaşılan + 104 API testi
npm run test:e2e    # 26 adım (iki hesap, hangar ve mağaza dahil)
npm run test:ui     # 22 adım (Playwright gerekir)
```
