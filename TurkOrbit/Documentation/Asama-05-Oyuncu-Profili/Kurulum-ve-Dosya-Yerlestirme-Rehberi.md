# Aşama 5 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-05-Oyuncu-Profili.zip`) **Aşama 1'i de içeren tam projedir**. İlk kez kuruyorsan [Aşama 1 rehberindeki](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) adımları uygula. Bu rehber, Aşama 1 kurulu bir sistemi güncellemeyi anlatır.

## 1. Dosyaları yerleştirme (güncelleme)

1. Çalışan API'yi durdur (`Ctrl+C` veya `pm2 stop turkorbit-api`).
2. Mevcut `TurkOrbit/` klasöründeki **`.env` dosyanı yedekle**. ZIP içinde `.env` yoktur, üzerine yazılmaz.
3. ZIP'i aç ve `TurkOrbit/` klasörünün üzerine kopyala (aynı adlı dosyaların değiştirilmesine izin ver).

Bu aşamada eklenen / değişen başlıca dosyalar:

| Dosya | Ne |
|---|---|
| `database/migrations/0002_player_profile.sql` | **Yeni migration**: sunucu, şirket, harita, rütbe, gemi, pilot, istatistik, başarım, para birimi, cüzdan, defter |
| `apps/api/src/modules/player/` | Pilot oluşturma, profil, şirket değişimi, herkese açık profil |
| `apps/api/src/modules/economy/wallet.ts` | Cüzdan çekirdeği (kilit + defter + idempotency) |
| `packages/shared/src/progression.ts`, `player.ts` | Seviye/rütbe hesapları, profil şemaları ve tipleri |
| `apps/client/src/pages/PilotPages.tsx`, `components/ShipArt.tsx` | Pilot oluşturma sihirbazı, profil ve herkese açık profil ekranları |
| `database/schema-draft.sql` | Taslak, 0002 ile hizalandı |

## 2. Komutlar

```bash
cd TurkOrbit
npm install            # yeni bağımlılık yok; kilit dosyası değişmiş olabilir
npm run db:migrate     # → "✔ uygulandı: 0002_player_profile.sql"
npm run dev:api        # veya üretimde: npm run build && npm run start -w @turkorbit/api
npm run dev:client
```

> Migration yalnızca bir kez uygulanır; tekrar çalıştırmak güvenlidir ("zaten uygulanmış" der). Uygulanmış migration dosyalarını **asla düzenleme**.

## 3. Deneme

1. http://localhost:5173 → giriş yap → otomatik olarak **Pilot** sayfasına yönlenirsin.
2. E-posta adresin doğrulanmamışsa sihirbaz uyarı gösterir. Doğrula, sonra şirketini seç ve **Pilotu oluştur**'a bas.
3. Profilde Oyuncu ID, şirket, seviye, rütbe, Kredi/Akçe, Kırlangıç gemisi, konum, istatistikler, başarımlar ve para hareketleri görünür.
4. "Herkese açık profilim" bağlantısı: `http://localhost:5173/pilot/TR1/<pilot-adı>` (oturum gerektirmez).

## 4. Başlangıç değerlerini değiştirme (Yönetim Merkezi gelene kadar)

```sql
-- Yeni pilotların başlangıç paraları
UPDATE game_settings SET value = '{"KREDI": 50000, "AKCE": 1500}' WHERE key = 'starter.currencies';
-- Şirket değiştirme: 14 gün, 1500 Akçe
UPDATE game_settings SET value = '{"cooldown_days": 14, "cost": {"currency": "AKCE", "amount": 1500}}' WHERE key = 'company.change';
```
Değişiklik yeniden başlatma gerektirmez; bir sonraki istekte geçerli olur. Aşama 14'te bu ayarlar Yönetim Merkezi'nden denetim kaydıyla yapılacak.

## 5. Testler

```bash
npm test            # 24 paylaşılan + 84 API testi (gerçek PostgreSQL + Redis)
npm run test:e2e    # 23 adım: iki hesap, web + Android uygulama oturumu, pilot oluşturma ve herkese açık profil
npm run test:ui     # 17 adım: masaüstü + iPhone görünümü (Playwright gerekir)
```
