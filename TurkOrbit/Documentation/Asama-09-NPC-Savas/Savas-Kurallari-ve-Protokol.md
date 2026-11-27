# Aşama 9 — NPC, Savaş Kuralları ve Protokol Ekleri

**Protokol sürümü:** `PROTOCOL_VERSION = 2` (Aşama 8'de 1'di; eski istemci `4010` ile "sayfayı yenile" uyarısı alır)
**Kurallar:** `packages/shared/src/combat.ts` · **Sunucu:** `apps/api/src/game/{server,content,persistence}.ts`
**Veri:** `database/migrations/0005_combat.sql`

> **İlke:** İstemci yalnızca **niyet** gönderir: hedef seç, ateş aç/kapa, mühimmat seç, roket at, yeniden doğ.
> Hasar, menzil, atış hızı, mühimmat tüketimi, ölüm ve ödül **yalnızca sunucuda** hesaplanır.
> `damage`, `hit`, `amount` gibi alan içeren mesajlar şema tarafından reddedilir.

## 1. İstemci → sunucu (yeni mesajlar)

| Mesaj | Alanlar | Sunucuda denetlenen |
|---|---|---|
| `target` | `id` (varlık) veya `null` | Varlık aynı haritada ve **radar menzilinde** olmalı; değilse hedef temizlenir |
| `attack` | `on` | Hedef yoksa veya takılı lazer yoksa reddedilir (Türkçe uyarı) |
| `ammo` | `c`: `ammo.isk1`…`ammo.isk4`, `ammo.se50` | Yalnızca bu kodlar kabul edilir |
| `rtype` | `c`: `rocket.yildirim`, `rocket.simsek`, `rocket.tufan`, `rocket.buz` | Yalnızca bu kodlar |
| `rocket` | — | Hedef, menzil, bekleme süresi, stok, saldırı izni |
| `respawn` | — | Yalnızca ölüyken |

## 2. Sunucu → istemci (yeni ve değişen mesajlar)

| Mesaj | Alanlar | Açıklama |
|---|---|---|
| `snap.e[]` | `[id, x, y, h, vx, vy, can%, kalkan%]` | Pilotlar, NPC'ler (radar menzili) ve kargo kutuları (kargo algılama menzili, 600) |
| `snap.st` | `[can, azami can, kalkan, azami kalkan, anlık hız]` | Anlık hız yavaşlatma etkisini içerir; istemci tahmini bunu kullanır |
| `snap.fx` | Efekt listesi | `['l', atan, hedef, mühimmat]` lazer (9 = NPC ışını) · `['r', atan, hedef, roket]` · `['d', hedef, miktar, 1=yalnız kalkan]` hasar sayısı · `['x', varlık, x, y, boyut]` patlama. Yalnızca radar menzilindeki olaylar gönderilir |
| `enter.e[]` | `k`: `p` pilot · `n` NPC · `c` kargo; NPC için `z` (ölçek), `b` (kadim/boss) | |
| `cs` | `target, attacking, ammo, rocket, counts{}, rocketCooldownMs, laserRange` | Savaş durumu değişince (en fazla 10 Hz) |
| `reward` | `source, xp, honor, currencies[], items[], level, levelUp, share?` | NPC ödülü, kargo, PvP şerefi. Veritabanına yazıldıktan **sonra** gönderilir |
| `dead` | `by` (vuran), `kind` (`npc` / `player`) | Pilot öldü; yeniden doğana kadar hareket ve geçit yok |
| `map` | `reason: 'respawn'` | Yeniden doğma: şirket başlangıç haritası, istasyon |

## 3. Savaş kuralları (sunucu)

### Lazer
- **Atış aralığı:** `tur hasarı / saniyelik hasar` (OK lazerleri 1000 ms). İstemci daha sık ateş mesajı gönderse de bu aralık değişmez (test edildi).
- **Hasar:** `tur hasarı × mühimmat çarpanı × ±%10`. Çarpanlar: IŞK-1 ×1, IŞK-2 ×2, IŞK-3 ×3, IŞK-4 ×4, SE-50 ×2. SE-50 ayrıca kalkana verilen hasarın %25'ini kendi kalkanına çeker.
- **Menzil:** aktif konfigürasyondaki en kısa lazer menzili (OK-1: 600). Menzil dışında ateş bekler; istemci "Menzil dışı — yaklaş" gösterir.
- **Mühimmat:** her atış takılı lazer başına 1 mühimmat harcar. Bellekte anında düşülür, 5 sn'de bir toplu olarak envanterden düşülür (defter: `ammo_used`, idempotent anahtar). Mühimmat bitince ateş durur ve uyarı gelir.

### Roket
- **Değerler:** Hasar, menzil ve bekleme süresi eşyanın değerlerinden gelir; her atış bir roket harcar.
- **Özel etkiler:** Tufan (R-3) hedefin 200 birim çevresindeki saldırılabilir varlıklara alan hasarı verir. Buz-R hedefi 2 sn yavaşlatır.
- **Sınırlama:** Roket atar ile çoklu atış (volley) Aşama 10+'ya bırakıldı.

### Hasar ve kalkan
- Hasarın `emme oranı` kalkana gider (Siper-1: %50), kalanı gövdeye. Kalkan bitince tüm hasar gövdeye gider.
- **Kalkan yenilenmesi:** 4 sn savaş dışı kalınca saniyede azami kalkanın %8'i.
- **Onarım robotu** (ekstra modül `repair`): 5 sn savaş dışı kalınca saniyede belirtilen miktar gövde.

### Saldırı izni (`canAttack`)
| Durum | Sonuç |
|---|---|
| Saldıran veya hedef güvenli bölgede | ✖ "Güvenli bölgede saldırı yapılamaz." / "Hedef güvenli bölgede." |
| Hedef NPC | ✔ her haritada |
| Hedef pilot, harita PvP kapalı (x-1 başlangıç haritaları) | ✖ |
| Hedef pilot, aynı şirket | ✖ |
| Hedef pilot, düşman şirket, PvP haritası | ✔ |

### Ölüm ve yeniden doğma
- Gemi yok olur: patlama efekti, `dead` mesajı, `combat_deaths` kaydı, `player_stats.deaths + 1`, aktif geminin canı 0.
- **Yeniden doğ:** şirketin başlangıç haritası (istasyon), canın %10'u ("acil onarım"); tam onarım hangarda Kredi ile.
- **Bağlantı kopukken ölüm:** Bağlantısı kopan gemi 30 sn haritada kalır ve bu sürede vurulabilir. Ölen pilot tekrar bağlanınca otomatik olarak istasyonda doğar ve bildirim alır.
- **PvP:** Düşman pilotu yenen `pvp_honor` (100) şeref ve `player_kills + 1` kazanır.

### Ödüller
- **Katkıya göre paylaşım** (`splitRewards`, `packages/shared/src/combat.ts`). NPC'yi birden çok pilot vurduysa:
  - Kredi, Akçe, deneyim ve şeref her pilota `aşağı yuvarla(miktar × hasar payı)` olarak verilir; yuvarlama artığı en çok hasar verene gider.
  - Bölünemeyen ödüller (eşya), kargo kutusu ve öldürme kaydı (`npc_kill_log`, `npc_kills`) **en çok hasar verenindir**.
  - Pay, NPC'ye verilen toplam hasar (kalkan + gövde) içindeki paydır. Ödül anında **aynı haritada olmayan** pilotun payı kimseye dağıtılmaz; böylece ödül çoğalamaz.
  - Payı hiçbir ödüle yetmeyen pilot ödül mesajı almaz. Birden çok pilot varsa mesaj "Çakal yok edildi (katkın %40)" biçimindedir ve `share` alanını taşır.
  - NPC savaş dışında tamamen yenilenirse hasar kayıtları sıfırlanır.
- **Doğrudan ödüller** (`delivery = 'direct'`): Kredi, Akçe (şanslı), deneyim, şeref. Tüm pilotlarınki tek transaction'da yazılır (kilit sırası oyuncu kimliğine göre):
  - `npc_kill_log` (`kill_id` benzersiz: aynı öldürme iki kez ödüllenemez)
  - `currency_ledger` (`npc_reward`, pilot başına idempotent anahtar `npc:<kill_id>:<pilot>:<para>`)
  - `players.experience`
  - `player_stats.npc_kills` (yalnızca en çok hasar veren)
- **Seviye atlama:** Deneyim eşiği geçilirse `levelUp` bildirilir.
- **Kargo** (`delivery = 'cargo'`):
  - NPC'nin öldüğü yere kargo kutusu düşer ve yalnızca kargo algılama menzilinde (600) görünür.
  - İlk 15 sn yalnızca en çok hasar veren pilot alabilir; kutu 60 sn sonra kaybolur.
  - Üzerine gelince toplanır: `item_ledger` `cargo_loot` (idempotent) ve `player_stats.cargo_collected`.

## 4. NPC yapay zekâsı

| Davranış | Aileler | Ne yapar |
|---|---|---|
| `passive` + `pack` | Çakal, Çakal Avcı | Saldırılmadıkça saldırmaz; vurulunca aynı sürüden 1500 birim içindekiler de saldırgana yönelir |
| `aggressive` | Sürü Başı, Akrep türleri, Örümcek türleri | `aggro_range` içindeki (güvenli bölgede olmayan) en yakın pilota saldırır |
| `kite` | Yarasa türleri | Saldırgan; menzilin kenarında kalır, hedefin çevresinde döner (vur-kaç) |
| Etki `poison` | Akrep | Vuruşun %30–40'ı kadar ek hasar 3–4 sn boyunca kalkanı atlayarak gövdeye |
| Etki `slow` | Örümcek | Pilot 1,5–2,5 sn yavaşlar (%40–50) |

- **Dolaşma:** Hedefi yokken yuva alanında rastgele noktalara yarı hızla gider.
- **Bağ mesafesi** (`leash`): Yuvasından çok uzaklaşırsa hedefi bırakıp geri döner. Hedef ölür, haritadan çıkar veya güvenli bölgeye girerse de bırakır.
- **Güvenli bölge:** NPC güvenli bölgeye giremez ve oradaki pilota saldırmaz (test edildi).
- **Yenilenme:** Savaş dışında 5 sn sonra can ve kalkan yenilenir. Ölen NPC, doğma noktasının `respawn_seconds` süresi sonunda yeniden doğar.
- **Performans:** Yalnızca içinde pilot olan haritaların NPC'leri simüle edilir. Oda, son pilot çıkınca kapanır.

## 5. İçerik (0005_combat.sql — Yönetim Merkezi'nden düzenlenecek)

| Tür | Aile | Can / Kalkan | Hasar | Davranış | Deneyim / Kredi |
|---|---|---|---|---|---|
| Çakal | Çakal | 400 / 200 | 15 | pasif sürü | 400 / 400 |
| Çakal Avcı | Çakal | 1.200 / 600 | 40 | pasif sürü | 1.200 / 1.000 |
| Sürü Başı | Çakal | 4.000 / 2.000 | 100 | saldırgan sürü | 4.000 / 3.000 (+2 Akçe %30) |
| Akrep | Akrep | 2.000 / 1.000 | 60 + zehir | saldırgan | 2.400 / 2.000 |
| Kara Akrep | Akrep | 6.000 / 3.000 | 150 + zehir | saldırgan | 7.200 / 6.000 (+5 Akçe %30) |
| Akrep Kraliçe ★ | Akrep | 40.000 / 20.000 | 500 + zehir | saldırgan | 50.000 / 40.000 (+40 Akçe) |
| Örümcek | Örümcek | 3.000 / 1.500 | 80 + yavaşlatma | saldırgan | 3.200 / 2.600 |
| Ağ Ören | Örümcek | 9.000 / 4.500 | 200 + yavaşlatma | saldırgan | 10.000 / 8.000 (+6 Akçe %30) |
| Ana Örümcek ★ | Örümcek | 60.000 / 30.000 | 700 + yavaşlatma | saldırgan | 70.000 / 60.000 (+60 Akçe) |
| Yarasa | Yarasa | 5.000 / 2.500 | 150 | vur-kaç | 6.000 / 5.000 |
| Gece Yarasası | Yarasa | 15.000 / 7.500 | 400 | vur-kaç | 18.000 / 15.000 (+12 Akçe %50) |

- **Kargo ödülleri:** Tüm türler IŞK-1 (%60) bırakabilir; 2. kademeden itibaren IŞK-2 (%20), 3. kademeden itibaren Yıldırım roketi (%15), 6. kademeden itibaren IŞK-3 (%15) eklenir.
- **Yerleşim:** 21 harita, 111 doğma alanı, en fazla 414 canlı NPC.
  - x-1 haritaları: Çakal.
  - x-2: Çakal Avcı, Sürü Başı, Akrep.
  - x-3: Akrep türleri, Örümcek.
  - x-4: Örümcek türleri, Ana Örümcek.
  - S haritaları: Kara Akrep, Yarasa, Ağ Ören, Akrep Kraliçe.
  - Ç haritaları: Gece Yarasası, Ağ Ören, Akrep Kraliçe, Ana Örümcek.
  - Doğma alanları güvenli bölgelerin dışındadır.
- **Henüz eklenmeyen aileler:** Kırkayak (çok parçalı), Tepegöz (boss) ve Gök Ejderi (etkinlik boss'u). Bunlar Yıldız Kapıları ve etkinliklerle birlikte gelecek.

## 6. Ayarlar (`game_settings.combat`)
```json
{"respawn_hp_ratio": 0.1, "shield_regen_delay_ms": 4000, "shield_regen_ratio_per_sec": 0.08,
 "repair_delay_ms": 5000, "loot_owner_ms": 15000, "loot_ttl_ms": 60000, "loot_pickup_radius": 90,
 "pvp_honor": 100, "damage_variance": 0.1, "out_of_combat_ms": 5000}
```
Oyun sunucusu NPC türlerini, ödül tablolarını ve savaş ayarlarını açılışta okur. Doğma noktaları ise harita (oda) açılırken okunur. Canlı yenileme Aşama 14'tedir (içerik sürümleme + Redis yayını).

## 7. İstemci kontrolleri

| İşlem | PC | Telefon / tablet |
|---|---|---|
| Hedef seç | Gemiye/NPC'ye tıkla · **Tab** (en yakın, tekrar basınca sıradaki) | Dokun · 🎯 butonu |
| Ateş aç/kapa | **Boşluk** · Ateş butonu | Büyük kırmızı Ateş butonu (joystick'in karşı tarafında) |
| Mühimmat | **1–5** · çubuktaki kutular | Çubuktaki kutular |
| Roket | **R** | Roket butonu |
| Hedefi bırak | **Esc** · hedef panelindeki × | × |
| Kargo topla | Kutuya tıkla (gemi gider) | Kutuya dokun |

Tuşlar ayarlardan değiştirilebilir (Ateş, Roket, En yakın hedef).
