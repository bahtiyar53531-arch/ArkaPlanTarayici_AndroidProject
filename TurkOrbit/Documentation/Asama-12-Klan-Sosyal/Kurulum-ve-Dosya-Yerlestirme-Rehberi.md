# Aşama 12 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-12-Klan-Sosyal.zip`) **Aşama 1–11'i de içeren tam projedir**.
- İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak.
- Oyun sunucusu için [Aşama 8 rehberine](../Asama-08-Multiplayer/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak.
- Bu rehber, Aşama 11 kurulu bir sistemi günceller.

> **Önemli:**
> - **Yeni migration:** `0008_social.sql`. Klan, rütbe, hazine, diplomasi, arkadaşlık, engelleme, gizlilik, sohbet, şikâyet ve bildirim tablolarını ve `clan`, `social`, `chat` ayarlarını ekler. Başlatmadan önce `npm run db:migrate` çalıştır.
> - **Sohbet ve grup Redis'e muhtaçtır:** Mesajlar süreçler arası `game:chat`, bildirimler `game:deliver`, diplomasi `game:relations` kanalıyla iletilir. Grup durumu Redis'te `party:*` anahtarlarında tutulur. Oyun sunucusu ve API aynı Redis'e bağlı olmalı (zaten öyle).
> - Protokol sürümü değişmedi (2); yeni mesajlar eklendi. Oyun sunucusunu ve istemciyi **birlikte** güncelle.

## 1. Dosyaları yerleştirme
1. API'yi, oyun sunucusunu ve istemciyi durdur.
2. `.env` dosyanı ve veritabanını yedekle: `pg_dump -Fc turkorbit > turkorbit-asama11.dump`.
3. ZIP'i aç ve `TurkOrbit/` üzerine kopyala.
4. `npm install` ve `npm run db:migrate` çalıştır. Çıktıda `✔ uygulandı: 0008_social.sql` görünmelidir.

| Yeni / değişen dosya | Ne |
|---|---|
| `database/migrations/0008_social.sql` | **Yeni:** 15 tablo (klan ×9, arkadaşlık, engel, gizlilik, sohbet, şikâyet, bildirim) + ayarlar |
| `packages/shared/src/social.ts` | **Yeni:** klan yetkileri ve rütbe sıralaması, etiket/ad kuralları, sohbet filtresi, grup konum izni, istek şemaları, API tipleri |
| `packages/shared/src/{combat,net,player,api-types,index}.ts` | Saldırı kuralında grup/klan/diplomasi; sohbet ve grup mesajları; klan etiketi; profilde klan; hata kodları |
| `apps/api/src/modules/social/` | **Yeni:** klan servisi, sosyal servis (arkadaş, engel, gizlilik, bildirim, şikâyet, sohbet geçmişi), hazine defteri, bildirim kutusu, Redis grup deposu, uçlar |
| `apps/api/src/game/{server,persistence}.ts` | Sohbet kanalları, grup, ilişkiye göre saldırı, klan etiketi, NPC ödülünden klan vergisi |
| `apps/api/src/modules/{market,player,game}/…` | Açık artırma bildirimleri, profilde klan, Redis köprüsü kanalları |
| `apps/client/src/components/game/SocialHud.tsx` | **Yeni:** sohbet paneli, grup paneli, grup daveti kartı, pilot menüsü |
| `apps/client/src/components/social/{ReportDialog,NotificationBell}.tsx` | **Yeni:** şikâyet penceresi, bildirim zili |
| `apps/client/src/pages/{ClanPages,SocialPages}.tsx` | **Yeni:** `/klan`, `/klan/:sunucu/:etiket`, `/sosyal` |
| `apps/client/src/{pages/GamePage.tsx, game/*, components/game/GameHud.tsx, components/Layout.tsx, pages/PilotPages.tsx, App.tsx, styles/*}` | Oyun içi yerleşim, etiketler, mini haritada grup, menü, profil işlemleri |

Yeni ortam değişkeni ve yeni bağımlılık **yok**.

## 2. Geliştirme ortamında deneme
1. **İki hesapla dene:** biri normal tarayıcıda, diğeri gizli pencerede ya da başka tarayıcıda.
2. **Klan:**
   - Seviye 5 ve 50.000 Kredi gerekir. Geliştirme veritabanında SQL ile ayarlanabilir: `UPDATE players SET experience = 139300 WHERE pilot_name = '…'`.
   - **Klan** sayfasından klanı kur. Diğer hesapla ara ve başvur; ilk hesapta 🔔 zilinde başvuru görünür.
3. **Sosyal:** Arkadaş ekle, diğer hesapta **İstekler** sekmesinden kabul et. **Gizlilik**'te konum paylaşımını değiştir.
4. **Oyun:**
   - İki hesapla **Oyna**. Masaüstünde Enter ile sohbete yaz.
   - Bir adın üstüne tıklayıp **Gruba davet et**, diğer hesapta kartta **Kabul et**.
   - Haritalar farklıyken grup panelinde konumun izne göre değiştiğini gör.
5. **Diplomasi:** İki klanla savaş ilan et. PvP haritasında (ör. K-2) aynı şirketten pilotların birbirine ateş edebildiğini gör.

## 3. Üretim
```bash
npm ci && npm run build
npm run db:migrate
systemctl restart turkorbit-api turkorbit-game
```
- Birden çok oyun sunucusu süreci aynı Redis'i kullandıkça sohbet ve grup süreçler arasında çalışır.
- **nginx:** WebSocket ayarı değişmedi. REST uçları `/api/v1` altında.
- Sohbet kayıtları `chat_messages` tablosunda birikir. Saklama süresi ve temizlik görevi Aşama 16'da (performans ve bakım) eklenecek; o zamana kadar tablo dizinlidir ve sorgular son 50 kaydı okur.

## 4. Değerleri değiştirme (Yönetim Merkezi gelene kadar, SQL ile)

| Ne | Nerede | Ne zaman yansır |
|---|---|---|
| Klan ücreti, seviye, üye ve ilişki sınırı | `game_settings.clan` | Hemen |
| Arkadaş/engel sınırı, grup boyutu, davet süresi | `game_settings.social` | API: hemen · oyun sunucusu: 15 sn içinde |
| Sohbet uzunluğu, hız sınırı, susturma, yasaklı kelimeler | `game_settings.chat` | Oyun sunucusu 15 sn içinde okur |
| Şikâyet kuyruğu | `SELECT * FROM reports WHERE status = 'open' ORDER BY created_at` | Okuma (yönetim ekranı Aşama 14) |

## 5. Testler
```bash
npm test            # ortak (filtre, yetkiler, konum izni, saldırı kuralı) + API (klan, hazine, diplomasi, arkadaş, şikâyet, sohbet, grup, saldırı)
npm run test:e2e    # API uçtan uca: klan, arkadaşlık, WebSocket sohbet, grup konum izni, engelleme ve şikâyet
npm run test:ui     # tarayıcı: klan kurma, bildirim zili, arkadaşlık, oyunda sohbet, grup paneli ve konum izni, şikâyet, telefonda sohbet ve klan
```
