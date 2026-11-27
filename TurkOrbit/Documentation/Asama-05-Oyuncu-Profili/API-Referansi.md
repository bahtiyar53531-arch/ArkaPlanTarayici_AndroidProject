# Aşama 5 — Oyuncu Profili API Referansı

**Temel adres:** `/api/v1`. Oturum, CSRF, hata biçimi ve platform başlıkları Aşama 1 ile aynıdır ([Aşama 1 API](../Asama-01-Kayit-Giris/API-Referansi.md)). `PATCH` isteklerinde de web oturumu için `X-CSRF-Token` zorunludur.

## Uç noktalar

| Yöntem | Yol | Oturum | Gövde / sorgu | Yanıt |
|---|---|---|---|---|
| GET | `/game/servers` | isteğe bağlı | – | `200 {servers:[{code, name, region, isOpen, isMaintenance, pilotCount, hasMyPilot}]}` |
| GET | `/game/companies` | – | `?server=TR1` (isteğe bağlı) | `200 {companies:[{code, name, motto, description, focus, colorHex, homeMap:{code,name}, pilotCount}]}` |
| POST | `/players` | ✔ + **e-posta doğrulanmış** | `{serverCode, companyCode}` | `201 {pilot: PilotProfile}` |
| GET | `/players/me` | ✔ | – | `200 {pilots: PilotProfile[]}` (pilotu yoksa boş dizi) |
| PATCH | `/players/me` | ✔ | `{serverCode, motto}`: **değiştirilebilen tek alan slogandır** | `200 {pilot}` |
| POST | `/players/me/company` | ✔ | `{serverCode, companyCode}` | `200 {pilot}`: ücret düşülür, yeni şirketin başlangıç haritasına taşınır |
| GET | `/players/me/ledger` | ✔ | `?server=TR1` | `200 {entries:[{id, currency, delta, balanceAfter, reason, createdAt}]}` (son 50) |
| GET | `/pilots/:server/:pilotName` | – | – | `200 {pilot: PublicPilotProfile}` (IP başına 120/dk) |

## `PilotProfile` (yalnızca sahibine)

```jsonc
{
  "id": "uuid", "playerId": 100001, "pilotName": "AnadoluKartali",
  "server": { "code": "TR1", "name": "Anadolu-1" },
  "company": { "code": "GKB", "name": "Gökbörü Filosu", "colorHex": "#29C5FF" },
  "level": { "level": 1, "experience": 0, "levelStartXp": 0, "nextLevelXp": 5000, "progress": 0 },
  "honor": 0,
  "rank": { "id": 1, "name": "Pilot Adayı", "points": 0, "minPoints": 0, "next": { "name": "Uzay Pilotu", "minPoints": 100 } },
  "currencies": [ { "code": "KREDI", "name": "Kredi", "isPremium": false, "balance": 25000 },
                  { "code": "AKCE", "name": "Akçe", "isPremium": true, "balance": 1000 } ],
  "activeShip": { "code": "kirlangic", "name": "Kırlangıç", "shipClass": "starter", "hitpoints": 4000, "maxHitpoints": 4000,
                  "speed": 320, "cargoCapacity": 100, "slots": { "laser": 1, "generator": 1, "extra": 1, "drone": 0 } },
  "map": { "code": "G-1", "name": "Gökbörü Üssü", "mapType": "starter", "pvpEnabled": false, "x": 18200, "y": 1800 },
  "playtimeSeconds": 0,
  "stats": { "npcKills": 0, "playerKills": 0, "deaths": 0, "gatesCompleted": 0, "cargoCollected": 0, "damageDealt": 0, "damageTaken": 0 },
  "achievements": { "earned": 1, "total": 10, "items": [ { "code": "pilot_created", "progress": 1, "target": 1, "completedAt": "…" } ] },
  "motto": null,
  "companyChange": { "availableAt": "2026-12-27T…", "cost": { "currency": "AKCE", "amount": 2000 }, "cooldownDays": 30 },
  "clan": null, "createdAt": "…", "lastOnlineAt": null
}
```

- **Seviye ve rütbe saklanmaz.** Sunucu her istekte deneyimden ve istatistiklerden hesaplar (`packages/shared/src/progression.ts`).
  - Seviye eğrisi: `xpForLevel(n) = 5000 × (n−1)^2.4` (100'e yuvarlanır), en yüksek seviye 50.
  - Rütbe puanı: `deneyim/1000 + max(şeref,0)/10 + 2×NPC + 10×pilot + 100×kapı`, 18 rütbe.
- **Başarımlar** profil okunurken istatistiklerden senkronize edilir. Hedefe ulaşan başarım kalıcı olarak verilir (idempotent).

## `PublicPilotProfile` (herkese açık)
Pilot adı, Oyuncu ID, sunucu, şirket, seviye, şeref, rütbe, slogan, NPC/pilot/kapı istatistikleri, kazanılan başarımlar, aktif gemi adı ve kayıt tarihi.
**İçermez:** e-posta, para birimleri, konum/harita, oynama süresi, deneyim miktarı, hasar istatistikleri.

## Yeni hata kodları

| Kod | HTTP | Ne zaman |
|---|---|---|
| `EMAIL_NOT_VERIFIED` | 403 | Doğrulanmamış hesapla pilot oluşturma |
| `PILOT_EXISTS` | 409 | Aynı sunucuda ikinci pilot |
| `PILOT_NOT_FOUND` | 404 | Pilot yok / herkese açık profil bulunamadı |
| `SERVER_CLOSED` | 403 | Sunucu kapalı veya bakımda |
| `SAME_COMPANY` | 400 | Zaten üyesi olunan şirkete geçiş |
| `COMPANY_CHANGE_COOLDOWN` | 409 | Bekleme süresi dolmadı |
| `INSUFFICIENT_FUNDS` | 400 | Bakiye yetersiz (para düşülmez) |
| `VALIDATION_ERROR` | 400 | İzin verilmeyen alan (ör. `experience`, `honor`, `stats`, `level`) |

## Yönetim Merkezi ayarları (canlı etkili)

| `game_settings` anahtarı | Varsayılan | Etkisi |
|---|---|---|
| `starter.currencies` | `{"KREDI": 25000, "AKCE": 1000}` | Yeni pilotların başlangıç paraları (bir sonraki pilot oluşturmada geçerli) |
| `company.change` | `{"cooldown_days": 30, "cost": {"currency": "AKCE", "amount": 2000}}` | Şirket değiştirme bekleme süresi ve ücreti |
