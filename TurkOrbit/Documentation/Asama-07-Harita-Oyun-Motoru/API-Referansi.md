# Aşama 7 — Harita ve Oyun Motoru API Referansı

**Temel adres:** `/api/v1` · Tüm uç noktalar oturum ister. Web oturumunda `POST`/`PUT` isteklerinde `X-CSRF-Token` zorunludur. Gövdelerde bilinmeyen alan gönderilirse istek `400 VALIDATION_ERROR` ile reddedilir.

> **Aşama 7'nin sınırı:** Hareket istemcide simüle edilir; istemci konumunu yaklaşık **saniyede bir** bildirir. Sunucu her bildirimi aktif geminin **gerçek hızına** göre denetler. Denetimden geçmeyen konum kaydedilmez, istemci sunucu konumuna geri çekilir. Aşama 8'de hareket tamamen WebSocket oyun sunucusunda hesaplanacak. Bu uç noktalar o zaman da yeniden bağlanma ve ilk yükleme için kullanılacak.

> **Aşama 8 güncellemesi:** `POST /world/position` ve `POST /world/jump` **kaldırıldı**. Hareket ve geçitler artık yalnızca WebSocket oyun sunucusunda: [Aşama 8 protokolü](../Asama-08-Multiplayer/Protokol.md). Aşağıdaki geçit kuralları aynen geçerlidir; konum, istemciden değil oyun sunucusunun hesapladığı konumdan alınır.

## Dünya

| Yöntem | Yol | Gövde | Yanıt |
|---|---|---|---|
| GET | `/world/galaxy?server=TR1` | – | `{galaxy:{currentMap, maps:[…], links:[[a,b]…]}}` |
| GET | `/world/map?server=TR1` | – | `{map: MapResponse}`. Pilot kapalı bir haritadaysa şirketinin ana haritasına taşınır, `notice` alanı doldurulur |
| POST | `/world/position` | `{serverCode, x, y}` | `{accepted, x, y, reason}`. Ret durumunda sunucu konumu döner |
| POST | `/world/jump` | `{serverCode, portalId, x, y}` | `{map: MapResponse}` (yeni harita) |

### Galaksi haritası (`maps[]` öğesi)
```jsonc
{ "code": "G-1", "name": "Gökbörü Üssü", "mapType": "company", "company": { "code": "GKB", "colorHex": "#29C5FF" },
  "minLevel": 1, "pvpEnabled": false, "galaxyX": 76, "galaxyY": 8, "isClosed": false,
  "access": { "ok": false, "code": "MAP_LOCKED", "requiredLevel": 15,
              "reason": "Düşman şirket bölgesine girmek için en az seviye 15 olmalısın." } }
```

### `MapResponse`
```jsonc
{
  "serverCode": "TR1",
  "pilot": { "pilotName": "AnadoluKartali", "level": 1,
             "company": { "code": "GKB", "name": "Gökbörü Filosu", "colorHex": "#29C5FF" },
             "ship": { "name": "Kırlangıç", "spriteKey": "ship-kirlangic", "hitpoints": 4000, "maxHitpoints": 4000,
                       "shield": 1000, "speed": 320 } },          // hız = aktif konfigürasyonun sunucu hesabı
  "map": { "code": "G-1", "name": "Gökbörü Üssü", "mapType": "company", "width": 20000, "height": 12500,
           "backgroundKey": "bg-g1", "pvpEnabled": false, "company": { "code": "GKB", "colorHex": "#29C5FF" } },
  "position": { "x": 18200, "y": 1800 },
  "portals": [{ "id": 11, "x": 18500, "y": 6250, "target": { "code": "G-2", "name": "Bozkır Yıldızları", "mapType": "company" },
                "access": { "ok": true } }],
  "zones": [{ "id": 4, "zoneType": "station", "name": "Gökbörü Üssü İstasyonu", "x": 18200, "y": 1800, "r": 700,
              "properties": {} }],
  "rules": { "jumpRadius": 450,
             "movement": { "tolerance": 1.25, "slack": 300, "max_elapsed_seconds": 10 },
             "detection": { "radar": 1500, "cargo": 600 } },   // radar = taban + gemi radar bonusu
  "notice": null
}
```
`zoneType`: `station` (istasyon), `safe` (güvenli bölge), `resource` (kaynak alanı; Aşama 11 madenciliği), `no_pvp`.

### Konum doğrulama kuralı
```
izin verilen mesafe = hız × min(geçen süre, max_elapsed_seconds) × tolerance + slack
```
- Değerler `game_settings.movement` kaydından okunur. Varsayılan: tolerance `1.25`, slack `300`, max_elapsed `10` sn.
- Harita sınırı dışındaki konum `out_of_bounds`, sınırı aşan mesafe `too_fast` sebebiyle reddedilir.
- Her ret `position_rejections` tablosuna yazılır (Aşama 8'de hile tespiti olaylarına taşınacak).
- Aynı pilottan **250 ms'den sık** gelen güncelleme `429 RATE_LIMITED` alır.

### Geçit (portal) kuralları — sırasıyla denetlenir
1. Geçit pilotun **bulunduğu haritada** olmalı ve açık olmalı (`404 PORTAL_NOT_FOUND`).
2. Bildirilen konum hız denetiminden geçmeli (`400 TOO_FAR_FROM_PORTAL`).
3. Pilot geçide en fazla `game_settings.portal.jump_radius` (450) uzaklıkta olmalı (`400 TOO_FAR_FROM_PORTAL`).
4. Hedef haritaya giriş koşulları (`403`):
   - `MAP_CLOSED`: harita bakımda.
   - `MAP_LOCKED`: seviye şartı. Düşman şirket haritaları için `entry_rules.enemy_company_min_level` (15) uygulanır.
5. Başarılı geçişte pilot, hedef haritadaki karşı geçidin 700 birim içerisine yerleşir ve geçiş `map_transitions` tablosuna yazılır.

## Oyuncu ayarları

| Yöntem | Yol | Gövde | Yanıt |
|---|---|---|---|
| GET | `/settings?deviceClass=desktop\|phone\|tablet` | – | `{deviceClass, settings}`. Kayıt yoksa cihaz sınıfının varsayılanları döner |
| PUT | `/settings` | `{deviceClass, settings}` | `{deviceClass, settings}` |

Ayarlar **hesaba ve cihaz sınıfına** bağlıdır. Bilgisayarda değiştirilen tuşlar her bilgisayarda geçerlidir, telefondaki joystick ayarlarını etkilemez.

```jsonc
{
  "controls": { "mode": "joystick" /* | "tap" */, "joystickSide": "left", "joystickSize": 1.0 /* 0.6–1.6 */,
                "joystickOpacity": 0.6 /* 0.2–1 */, "joystickOffsetY": 0.08 /* 0–0.4 */, "keyboardMove": true },
  "keys": { "up": "KeyW", "down": "KeyS", "left": "KeyA", "right": "KeyD", "jump": "KeyJ",
            "galaxy": "KeyM", "zoomIn": "Equal", "zoomOut": "Minus", "fullscreen": "KeyF" },   // KeyboardEvent.code
  "graphics": { "quality": "high" /* low|medium|high */, "fpsLimit": 60 /* 30|60|120 */, "showFps": false },
  "hud": { "scale": 1.0 /* 0.75–1.5 */, "minimapSize": "medium" /* small|medium|large */, "showCoordinates": true }
}
```

## Yeni hata kodları
`PORTAL_NOT_FOUND`, `TOO_FAR_FROM_PORTAL`, `MAP_LOCKED`, `MAP_CLOSED` (ayrıca `PILOT_NOT_FOUND`, `RATE_LIMITED`, `VALIDATION_ERROR`).

## Yönetim ayarları (Yönetim Merkezi gelene kadar SQL ile)
| Ayar | Anahtar / tablo |
|---|---|
| Hız denetimi toleransı | `game_settings.movement` → `{"tolerance", "slack", "max_elapsed_seconds"}` |
| Geçit atlama yarıçapı | `game_settings.portal` → `{"jump_radius"}` |
| Haritayı bakıma alma | `UPDATE maps SET is_closed = true WHERE code = 'K-5'` |
| Geçidi kapatma / ek şart | `map_portals.is_enabled`, `map_portals.requirements` (ör. `{"min_level": 10}`) |
| Düşman bölgesi seviye şartı | `maps.entry_rules` → `{"enemy_company_min_level": 15}` |
