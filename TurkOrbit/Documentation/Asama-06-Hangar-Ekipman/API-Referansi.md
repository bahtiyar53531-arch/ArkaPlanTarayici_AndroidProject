# Aşama 6 — Hangar ve Ekipman API Referansı

**Temel adres:** `/api/v1` · Tüm uç noktalar oturum ister. Web oturumunda `POST` isteklerinde `X-CSRF-Token` zorunludur. Gövdelerde bilinmeyen alan (ör. `price`, `damage`) gönderilirse istek `400 VALIDATION_ERROR` ile reddedilir.

> **`requestId` kuralı:** Para veya eşya harcayan her istek (satın alma, satış, yükseltme, tamir) istemcinin ürettiği bir **UUID** ister. Aynı `requestId` tekrar gönderilirse işlem **ikinci kez uygulanmaz** (çift tıklama, ağ tekrarı) ve ilk sonuç döner (`replay: true`).

## Hangar

| Yöntem | Yol | Gövde | Yanıt |
|---|---|---|---|
| GET | `/hangar?server=TR1` | – | `{hangar}`. Başlangıç kiti yoksa ilk açılışta verilir (idempotent) |
| GET | `/hangar/ledger?server=TR1` | – | `{entries:[{itemCode, itemName, delta, reason, createdAt}]}` (son 50 eşya hareketi) |
| POST | `/hangar/equip` | `{serverCode, shipId, loadout: 1\|2, slotType, slotIndex, itemId}` | `{hangar}` |
| POST | `/hangar/unequip` | `{serverCode, shipId, loadout, slotType, slotIndex}` | `{hangar}`: drone çıkarılırsa ekipmanı da çıkar |
| POST | `/hangar/loadout` | `{serverCode, loadout}` | `{hangar}`: kullanımdaki konfigürasyonu değiştirir |
| POST | `/hangar/ships/:shipId/activate` | `{serverCode}` | `{hangar}`: aktif gemiyi değiştirir |
| POST | `/hangar/ships/:shipId/design` | `{serverCode, itemId \| null}` | `{hangar}`: tasarım uygular/kaldırır |
| POST | `/hangar/ships/:shipId/repair` | `{serverCode, requestId}` | `{result:{repaired, cost}, hangar}` |
| POST | `/hangar/items/:itemId/sell` | `{serverCode, quantity?, requestId}` | `{result:{sold, earned, replay}, hangar}` |
| POST | `/hangar/items/:itemId/upgrade` | `{serverCode, requestId}` | `{result:{success, fromLevel, toLevel, chance, replay}, hangar}` |
| POST | `/hangar/pet/name` | `{serverCode, name}` | `{hangar}` |
| POST | `/hangar/pet/modules` | `{serverCode, slotIndex, itemId \| null}` | `{hangar}` |

### Slot kuralları (sunucuda uygulanır)

| Slot | Kabul eden kategori | Adet |
|---|---|---|
| `laser` | lazer topu | geminin `laser_slots` değeri |
| `generator` | kalkan veya hız jeneratörü | `generator_slots` |
| `extra` | ekstra modül, roket atar (konfigürasyon başına **tek** roket atar) | `extra_slots` |
| `drone` | drone | `drone_slots` |
| `drone_gear` | lazer veya kalkan (aynı sıradaki drone takılıysa) | `drone_slots` |

Ek kurallar:
- Yığın eşyalar (mermi, roket) slota takılmaz.
- Eşyanın seviye şartı karşılanmalıdır (`LEVEL_TOO_LOW`).
- Bir eşya **tek gemide** takılı olabilir (`ITEM_ON_OTHER_SHIP`). Aynı geminin iki konfigürasyonunda ortak kullanılabilir.
- Aynı eşya aynı konfigürasyonda başka bir slota takılırsa oraya **taşınır**.

### `hangar` yanıtı (özet)
```jsonc
{
  "serverCode": "TR1", "playerLevel": 1, "activeShipId": "…", "activeLoadout": 1,
  "ships": [{
    "id": "…", "type": { "code": "kirlangic", "name": "Kırlangıç", "shipClass": "starter", "hitpoints": 4000,
                         "baseSpeed": 320, "cargoCapacity": 100, "slots": { "laser": 1, "generator": 1, "extra": 1, "drone": 0 } },
    "spriteKey": "ship-kirlangic", "design": null, "hitpoints": 4000, "maxHitpoints": 4000, "isActive": true,
    "loadouts": { "1": [{ "slotType": "laser", "slotIndex": 0, "itemId": "…" }], "2": [ … ] },
    "stats": { "1": { "lasers": 1, "damagePerVolley": 40, "damagePerSecond": 40, "laserRange": 600, "shield": 1000,
                      "shieldAbsorb": 0.5, "speed": 320, "cargo": 100, "rocketVolley": 1, "drones": 0, … }, "2": { … } },
    "repairCost": null
  }],
  "inventory": [{ "id": "…", "code": "laser.ok1", "name": "OK-1 Lazer Topu", "category": "laser", "quantity": 1,
                  "upgradeLevel": 0, "maxUpgradeLevel": 10, "stats": { "damage": 40, "rateMs": 1000, "range": 600 },
                  "sellPrice": 2500, "equippedIn": [ … ], "usage": { "pet": false, "petModuleSlot": null, "designShipId": null },
                  "nextUpgrade": { "level": 1, "chance": 1, "currency": "KREDI", "amount": 2000 } }],
  "inventoryLimit": 300, "pet": null, "currencies": [ … ]
}
```
`stats` değerleri sunucuda `computeLoadoutStats` (packages/shared/src/items.ts) ile hesaplanır. Eşya istatistikleri her okumada kategori şemasıyla doğrulanır; bozuk veri kullanılmaz.

## Mağaza

| Yöntem | Yol | Gövde | Yanıt |
|---|---|---|---|
| GET | `/shop?server=TR1` | – | `{shop:{playerLevel, currencies, categories:[{code, name, offers:[ShopOffer]}]}}` |
| POST | `/shop/purchase` | `{serverCode, offerId, packs?, requestId}` | `{purchase:{offerId, packs, total, currency, replay}, currencies}` |

`ShopOffer`: `id, type (item|ship), code, name, description, category, rarity, stats, ship (gemi ise), quantity (paket başına adet), currency, price, finalPrice (indirimli), discountPercent, maxPerPurchase, minLevel, owned, limitReached, requiresShip`.

**Fiyat her zaman sunucudaki teklif kaydından hesaplanır.** İstemci fiyat gönderemez.

## Yeni hata kodları

| Kod | HTTP | Ne zaman |
|---|---|---|
| `ITEM_NOT_FOUND` / `SHIP_NOT_FOUND` | 404 | Eşya/gemi bu oyuncuya ait değil |
| `SLOT_INCOMPATIBLE` | 400 | Kategori slota uygun değil, yığın eşya, ikinci roket atar, uygunsuz tasarım/PET modülü |
| `SLOT_UNAVAILABLE` | 400 | Gemide böyle bir slot yok, drone olmadan drone ekipmanı, PET modül slotu yok |
| `LEVEL_TOO_LOW` | 403 | Seviye şartı |
| `ITEM_ON_OTHER_SHIP` | 409 | Eşya başka gemide takılı |
| `ITEM_IN_USE` | 409 | Takılı/PET/tasarım olan eşya satılamaz |
| `NOT_SELLABLE` | 400 | Satış fiyatı 0 veya bağlı eşya |
| `NOT_UPGRADABLE` / `MAX_UPGRADE` | 400 | Yükseltilemez / en üst seviye |
| `SHIP_NOT_DAMAGED` | 400 | Tamire gerek yok |
| `OFFER_UNAVAILABLE` | 404 | Teklif satışta değil (kapalı, tarih dışı, arşivlenmiş) |
| `PURCHASE_LIMIT` | 400/409 | Paket veya oyuncu başına sınır, ikinci PET |
| `SHIP_OWNED` | 409 | Gemi zaten hangarda |
| `INVENTORY_FULL` | 409 | Envanter sınırı |
| `PET_REQUIRED` | 400 | PET olmadan PET işlemi |
| `INSUFFICIENT_FUNDS` | 400 | Bakiye yetersiz (hiçbir şey verilmez/düşülmez) |

## Yönetim Merkezi ayarları (canlı etkili)

| `game_settings` / tablo | Varsayılan | Etkisi |
|---|---|---|
| `starter.kit` | OK-1, Siper-1, İtki-1, 2.000 IŞK-1, 50 Yıldırım | Yeni pilotların başlangıç ekipmanı |
| `repair` | `{"currency":"KREDI","per_1000_hp":250}` | Tamir ücreti |
| `inventory` | `{"max_items":300}` | Envanter sınırı (satır sayısı) |
| `item_types.stats`, `ship_types.*` | – | İstatistikler hangar hesabına anında yansır (test edildi) |
| `shop_offers.price / discount_percent / is_active` | – | Mağaza fiyatı/indirimi/satış durumu anında yansır (test edildi) |
| `upgrade_levels` | Seviye başına +%2; 1–5 Kredi, 6–10 Akçe; şans %100 → %30 | Yükseltme şansı ve ücreti |
