# Aşama 11 — Ekonomi: Kurallar, İçerik ve API

**Kurallar:** `packages/shared/src/economy.ts` · **Servis:** `apps/api/src/modules/market/service.ts` · **Madencilik:** `apps/api/src/game/server.ts`
**Veri:** `database/migrations/0007_economy.sql`

> **İlkeler:**
> - Fiyat, tarif, ödül ve teklif kuralı her zaman sunucudaki kayıttan okunur. İstemci yalnızca "ne" ve "kaç adet" söyler. Bilinmeyen alan içeren istek (`price`, `output`…) 400 ile reddedilir.
> - Her para ve eşya hareketi transaction içinde, satır kilidiyle ve idempotent defter anahtarıyla yazılır.
> - Çift tıklama, ağ tekrarı veya eşzamanlı istek çift ödeme ya da çift ödül üretmez (testli).

## 1. Kaynaklar

| Kaynak | Kademe | Satış (Kredi/birim) | Nereden |
|---|---|---|---|
| Kuvarsit | 1 | 8 | "Kuvarsit kuşağı" bölgeleri |
| Ferrolit | 1 | 10 | "Ferrolit kuşağı" bölgeleri |
| Titanyum Tozu | 1 | 14 | "Titanyum tozu bulutu" bölgeleri |
| Nebulit | 2 | 260 | Rafineri: 10 Kuvarsit + 10 Ferrolit + 50 Kredi (30 sn) |
| Kristalyum | 2 | 300 | Rafineri: 10 Ferrolit + 10 Titanyum + 60 Kredi (30 sn) |
| Kozmit | 3 | 2.400 | Rafineri: 4 Nebulit + 4 Kristalyum + 500 Kredi (120 sn, Sv 5) |
| Yıldız Özü | 4 | **satılamaz** | Rafineri: 3 Kozmit + 2.000 Kredi (300 sn, Sv 10) |

- Kaynaklar envanterde yığınlanabilir eşyadır (kategori `resource`).
- Satış, hangarın satış ucuyla yapılır: `POST /hangar/items/:id/sell`, defter gerekçesi `item_sell`.

## 2. Madencilik (oyun sunucusu)
- **Maden noktaları:**
  - Aşama 7'deki 45 kaynak bölgesinden üretilir: `resource_nodes`, en fazla 414 nokta.
  - Cevher türü bölge adından gelir.
  - Adet, yeniden doğma süresi ve verim harita türüne göre değişir:

| Harita türü | Nokta | Yeniden doğma | Verim |
|---|---|---|---|
| Başlangıç | 6 | 60 sn | 3–6 |
| Şirket | 8 | 75 sn | 4–8 |
| Sınır | 10 | 90 sn | 6–12 |
| Çekirdek | 12 | 120 sn | 8–15 |

- **Görünürlük:** Noktalar kargo algılama menzilinde (600) görünür (madde 18). İstemcide renkli kristal olarak çizilir ve mini haritada nokta olarak gösterilir. Tıklayınca gemi oraya gider.
- **Toplama:** Gemi noktanın 90 birim yakınına gelince kaynak toplanır (`game_settings.mining.pickup_radius`).
  - Verim sunucuda zarla belirlenir. Kayıt `item_ledger`'a `mining` gerekçesi ve `mine:<nokta>` anahtarıyla yazılır; aynı nokta iki kez verilemez.
  - Toplanan kaynak `collect_resource` görev olayını üretir.
- **Ambar:** Gemi kargo kapasitesi, gemi değeri artı Kargo Genişletici kadardır (Kırlangıç 100).
  - Ambar = envanterdeki tüm kaynakların toplamı.
  - Ambar doluyken toplanmaz ve "Ambarın dolu (100/100)…" bildirimi gelir. Yer azsa yalnızca sığan kadar alınır.
  - HUD'da "Ambar x / y" göstergesi var (`cs.cargo`).
- **Ambarı boşaltmak:** Satmak ya da rafineride işlemek (girdiler düşülür) ambarı boşaltır. Oyundaysan gösterge hemen güncellenir.
- **Kural:** Ambar sınırı yalnızca **toplamayı** durdurur. Ödül, satın alma veya üretimle gelen kaynak ambarı aşabilir; o durumda yeni toplama yapılmaz.

## 3. Rafineri ve üretim
- **12 tarif:** 4 rafineri, 8 atölye.
  - Atölye ürünleri: IŞK-2 ×200, IŞK-3 ×100, IŞK-4 ×50 (yalnızca üretimle), SE-50 ×100, Yıldırım ×20, Şimşek ×20, Buz-R ×10, Tufan ×10.
- **Başlatma:** Bütün girdiler (kaynak + Kredi) **hemen** düşülür. Biri eksikse hiçbiri düşülmez ve "Yetersiz kaynak: 10 Kuvarsit gerekiyor (elinde 0)" hatası döner.
  - Hazır olma anı = süre × adet. İş, başlatma anındaki çıktıyla saklanır; tarif sonradan değişse de etkilenmez.
- **Kuyruk:** Aynı anda en fazla 3 üretim yapılır; tek seferde en fazla 50 adet (`game_settings.crafting`).
- **Teslim alma:** Süre dolmadan 409 `CRAFT_NOT_READY` ("… sn kaldı") döner. Dolunca çıktı envantere girer (`crafting_output`); ikinci istek `replay` döner.
  - Teslim alma `craft_item` görev olayını üretir (adet = üretim adedi).
- **İdempotent:** Aynı `requestId` ile ikinci başlatma girdileri yeniden düşmez.
- **Kaynakların ulaşılabilirliği:** Düşük seviye haritalarda her şirketin farklı cevheri var:
  - Kızılelma: Ferrolit ve Titanyum (Kristalyum yapabilir);
  - Gökbörü: Titanyum ve Kuvarsit;
  - Altay: Ferrolit ve Kuvarsit (Nebulit yapabilir).
  - Diğer cevherler 5. seviye haritalarında ve sınırda bulunur. Bu bilinçli bir tasarımdır.

## 4. Açık artırma (sistem açık artırmaları)
- **Lotlar (9):**
  - Saatlik: 1.000 IŞK-2, 50 Şimşek, 10 Nebulit.
  - Günlük: OK-3 Lazer, Siper-3 Kalkan, 5 Kozmit.
  - Haftalık: OK-4 Lazer, Bozkır Atmacası tasarımı, Yaban Drone.
  - Para birimi Kredi.
- **Dönemler:** Saatlik UTC saat başı (TSİ ile aynı). Günlük her gün 05:00 TSİ, haftalık pazartesi 05:00 TSİ.
  - Her sunucu, lot ve dönem için tek açık artırma vardır (`UNIQUE (server_id, lot_id, period_key)`).
  - Oluşturma API sürecindeki zamanlayıcıyla (10 sn) ve liste isteğinde yapılır; birden çok süreçte güvenlidir.
- **Teklif** (aynı transaction'da):
  1. Açık artırma satırı kilitlenir (`FOR UPDATE`).
  2. İlk teklif en az taban fiyattır. Sonrakiler en az `max(%5, 100)` fazla olmalıdır; aksi halde 409 `BID_TOO_LOW` ("En az 4.200 Kredi teklif etmelisin").
  3. Cüzdanlar oyuncu kimliği sırasıyla kilitlenir (kilitlenme olmaz).
  4. Önceki en yüksek teklif sahibine iade edilir (`auction_refund`), sonra yeni tutar emanete alınır (`auction_bid`). Kendi teklifini artıran oyuncu emanetteki tutarını kullanabilir.
  5. **Son saniye uzatması:** Bitişe 60 sn'den az kala gelen teklif bitişi tekliften 60 sn sonraya alır.
- **Kapanış:** Süresi dolan açık artırma `FOR UPDATE SKIP LOCKED` ile alınır.
  - Kazanan eşyayı alır (`auction_win`, anahtar `auction:<id>:win`); emanetteki teklif harcanmış olur.
  - Teklifsiz açık artırma kazanansız kapanır. İkinci kez sonuçlandırılmaz.
- **Eşzamanlılık (testli):** 8 oyuncu aynı anda teklif verdi. Tek lider kaldı; kaybedenlerin bakiyesi başlangıçtakine döndü; negatif bakiye oluşmadı.

## 5. Günlük giriş ödülü
- 7 günlük takvim:

| Gün | Ödül |
|---|---|
| 1 | 2.000 Kredi |
| 2 | 500 IŞK-1 |
| 3 | 5.000 Kredi |
| 4 | 30 Yıldırım |
| 5 | 10.000 Kredi + 20 Titanyum |
| 6 | 300 IŞK-2 |
| 7 | 25 Akçe + 2 Nebulit |

- **Oyun günü:** 05:00 TSİ'de başlar. Dün de alındıysa seri bir artar; bir gün kaçırılırsa 1. günden başlar. 7. günden sonra takvim başa döner.
- **Tek alım:** Günde bir kez alınır (pilot satırı kilidi + `player_daily_logins` birincil anahtarı). Eşzamanlı iki istekten biri `replay` döner. Defter gerekçesi `daily_login`.

## 6. Mağaza paketleri
- `shop_offers.offer_type = 'bundle'`: başlık, açıklama, içerik (`bundle_items`). Mağazada **Paketler** kategorisi en baştadır.

| Paket | Fiyat | İçerik | Sınır |
|---|---|---|---|
| Acemi Pilot Paketi | 500 Akçe, **%40 indirimle 300** | 3.000 IŞK-1, 500 IŞK-2, 50 Yıldırım, Kargo Genişletici | Hesap başına 1 |
| Madenci Paketi | 45.000 Kredi | Kargo Genişletici, 4 Nebulit, 4 Kristalyum | — |
| Avcı Paketi | 600 Akçe | 1.000 IŞK-2, 300 IŞK-3, 30 Şimşek | Sv 6 (içerikteki en yüksek şart) |

- Tüm içerik tek transaction'da verilir. Envanter sınırı, paketin açacağı yeni satır sayısıyla denetlenir.

## 7. Eşzamanlılık kabul ölçütü (07)
- Ölçüt: "Eşzamanlı 50 satın alma isteğinde negatif bakiye yok; aynı `idempotency_key` iki kez uygulanmaz."
- Testler:
  - **50 farklı istek, bakiye yalnızca 3'üne yeter:**
    - Tam 3 satın alma oldu; diğer 47 istek `INSUFFICIENT_FUNDS` döndü.
    - Bakiye 35.000'den 5.000'e indi.
    - Defterde 3 kayıt (−30.000) var.
  - **Aynı `requestId` ile 50 istek:** Tek satın alma oldu, diğerleri `replay: true` döndü; bakiye bir kez düştü.

## 8. Görevler (madencilik ve üretim)
- Yeni hedef türleri: `collect_resource` (`params.resource`, `map_types`) ve `craft_item` (`params.item`).
- **18 yeni görev (toplam 318):**
  - "Altay'ın Mirası" zinciri (8): ilk cevherden Yıldız Özü'ne.
  - Günlük (6): "Maden Turu", "Ambar Dolusu", "Rafineri Mesaisi"…
  - Haftalık (4).
- Düşük seviye günlükleri "herhangi bir kaynak" ister, çünkü her şirketin başlangıç haritalarında farklı cevher vardır.

## 9. REST uçları (`/api/v1`, oturum gerekir; POST'larda CSRF)

| Uç | Gövde | Yanıt |
|---|---|---|
| `GET /market/crafting?server=TR1` | — | `{ crafting: { recipes[], jobs[], resources[], cargo{used,capacity}, slots, maxBatches } }` |
| `POST /market/crafting/start` | `{ serverCode, recipe, batches, requestId }` | `{ replay, crafting }` |
| `POST /market/crafting/claim` | `{ serverCode, jobId }` | `{ claimed{code,name,quantity}, replay, crafting }` |
| `GET /market/daily?server=TR1` | — | `{ daily: { today, claimedToday, day, streak, nextReset, calendar[] } }` |
| `POST /market/daily/claim` | `{ serverCode }` | `{ replay, reward{day, streak, currencies[], items[], …}, daily }` |
| `GET /market/auctions?server=TR1` | — | `{ auctions: { open[], history[], balances[] } }` |
| `POST /market/auctions/bid` | `{ serverCode, auctionId, amount, requestId }` | `{ replay, auctions }` |
| `POST /hangar/items/:id/sell` | `{ serverCode, quantity, requestId }` | Kaynak satışı (Aşama 6 ucu) |
| `POST /shop/purchase` | `{ serverCode, offerId, packs, requestId }` | Paketler dahil (Aşama 6 ucu) |

**Yeni hata kodları:**

| Kod | Ne zaman |
|---|---|
| `RECIPE_NOT_FOUND` | Tarif yok |
| `INSUFFICIENT_RESOURCES` | Kaynak yetersiz |
| `CRAFT_SLOTS_FULL` | Üretim kuyruğu dolu |
| `CRAFT_NOT_READY` | Üretim henüz bitmedi |
| `AUCTION_NOT_FOUND` | Açık artırma yok |
| `AUCTION_CLOSED` | Açık artırma bitti |
| `BID_TOO_LOW` | Teklif en düşük geçerli tutarın altında |

## 10. Ayarlar (`game_settings`)
```json
"crafting": {"slots": 3, "max_batches": 50}
"auction":  {"min_increment_pct": 5, "min_increment": 100, "snipe_window_seconds": 60, "extend_seconds": 60}
"mining":   {"pickup_radius": 90}
```
