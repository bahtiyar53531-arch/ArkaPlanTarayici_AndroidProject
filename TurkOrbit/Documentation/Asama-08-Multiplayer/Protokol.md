# Aşama 8 — Gerçek Zamanlı Oyun Protokolü

**Adres:** `wss://turkorbit.com/game` (geliştirmede `ws://localhost:5173/game` → Vite → `ws://127.0.0.1:4001/game`)
**Sürüm:** `PROTOCOL_VERSION = 1` · **Tik:** 50 ms (20 Hz) · **Anlık görüntü:** her 2 tikte (10 Hz)

> **Güncel sürüm 2 (Aşama 9):** Savaş mesajları eklendi; `snap.e[]` 8 öğeli (can % ve kalkan % eklendi), yeni `snap.st` (can, kalkan ve anlık hız), `snap.fx` efekt listesi, `enter.e[].k` varlık türü. Ayrıntı: [Aşama 9 — Savaş Kuralları ve Protokol Ekleri](../Asama-09-NPC-Savas/Savas-Kurallari-ve-Protokol.md). Bu belgedeki diğer kurallar (bilet, tik, AOI, tek oturum, kapanış kodları) geçerlidir.
**Tanımlar:** `packages/shared/src/net.ts` (sunucu ve istemci aynı dosyayı kullanır)

> **İlke:** Sunucu otoritelidir. İstemci yalnızca **niyet** gönderir (yön, hedef nokta, geçit). Konumu yalnızca oyun sunucusu hesaplar. İstemcinin konum yazabileceği bir mesaj yoktur; Aşama 7'deki REST konum ve geçit uç noktaları kaldırıldı.

## 1. Bağlantı akışı

```
İstemci                                   API                         Oyun sunucusu                 Redis
  │  POST /api/v1/game/ticket {serverCode} │                               │                           │
  │──────────────────────────────────────▶│  oturum + e-posta doğrulama   │                           │
  │                                        │  + pilot + bakım denetimi     │                           │
  │                                        │── SET game:ticket:<sha256> (60 sn) ─────────────────────▶│
  │◀─────────────── {ticket, expiresIn} ───│                               │                           │
  │  WebSocket /game ─────────────────────────────────────────────────────▶│  Origin denetimi          │
  │  {"t":"hello","v":1,"ticket":"…"} ────────────────────────────────────▶│── GETDEL bilet (tek sefer)▶│
  │                                        │                               │  oturum hâlâ geçerli mi?  │
  │                                        │                               │── SET game:session + PUBLISH game:kick ▶│
  │◀───────────────── {"t":"welcome", id, tick, map, you} ─────────────────│                           │
  │  {"t":"in", i:[[seq,m,x,y]]}  (her 50 ms) ────────────────────────────▶│                           │
  │◀───────────── {"t":"snap", k, a, y, e}  (10 Hz) ───────────────────────│                           │
```

- Bilet **60 sn** geçerlidir ve **tek kullanımlıktır** (Redis `GETDEL`). Oturum anahtarı WebSocket'e hiç gönderilmez.
- Bilet için şunlar gerekir: oturum, doğrulanmış e-posta, o sunucuda pilot. Sunucu bakımdaysa `503 SERVER_CLOSED` döner. Kullanıcı başına dakikada en fazla 30 bilet alınabilir.
- Bağlantı açıldıktan sonra **5 sn** içinde `hello` gelmezse bağlantı kapatılır.
- Tarayıcının gönderdiği `Origin` başlığı izinli listede değilse bağlantı reddedilir (başka sitenin sayfası bağlanamaz).

## 2. İstemci → sunucu

| Mesaj | Alanlar | Açıklama |
|---|---|---|
| `hello` | `v` (sürüm), `ticket` | İlk ve tek kimlik doğrulama mesajı |
| `in` | `i`: en fazla 10 komut, her biri `[seq, m, x, y]` | Her 50 ms'de bir girdi. `m=0` dur · `m=1` yön (x,y ∈ [-1,1]) · `m=2` hedef nokta (dünya koordinatı) |
| `jump` | `p` (geçit kimliği) | Geçitten atlama isteği. Konum gönderilmez; sunucu kendi konumunu kullanır |
| `ping` | `c` (istemci zamanı) | Gecikme ölçümü (2 sn'de bir) |

Tüm mesajlar zod ile doğrulanır. Bilinmeyen tür (ör. `pos`), bilinmeyen alan, sonsuz sayı veya 10'dan fazla komut **yok sayılır**. Yön girdisi [-1,1] aralığına, hedef nokta harita sınırına kırpılır.

## 3. Sunucu → istemci

| Mesaj | Alanlar | Ne zaman |
|---|---|---|
| `welcome` | `id` (varlık kimliği), `tick`, `tickMs`, `map` (MapResponse), `you` | Kimlik doğrulama sonrası |
| `snap` | `k` (tik), `a` (son işlenen girdi seq), `y` = `[x,y,vx,vy,h]` (2 ondalık), `e` = `[[id,x,y,h,vx,vy], …]` | 10 Hz |
| `enter` | `e`: `[{id, n: ad, cc: şirket, c: renk, s: gemi çizimi, l: seviye}]` | Bir pilot radar menziline girince (bir kez) |
| `leave` | `e`: `[id, …]` | Pilot menzilden çıkınca, haritadan ayrılınca veya oyundan çıkınca |
| `map` | `map`, `you`, `tick`, `reason`: `portal` \| `map_closed` | Geçit geçişi veya bakım nedeniyle taşınma |
| `pilot` | `ship` {hız, can, kalkan, çizim}, `radar` | Hangarda ekipman/konfigürasyon değişince (canlı) |
| `notice` | `kind`, `text` | Bilgi (ör. bakım taşıması) |
| `error` | `code`, `message` | Geçit hatası: `PORTAL_NOT_FOUND`, `TOO_FAR_FROM_PORTAL`, `MAP_LOCKED`, `MAP_CLOSED` |
| `kick` | `code`, `message` | Bağlantı kapatılmadan hemen önce sebep |
| `pong` | `c`, `s` (sunucu zamanı) | `ping` yanıtı |

**Sıra garantisi:** Bir bağlantıya ilk giden mesaj her zaman `welcome`'dır. Sunucu, `welcome` gönderilene kadar o bağlantıya `snap`, `enter` veya `leave` göndermez; bu bir regresyon testiyle korunur.

Varlık kimlikleri süreç içi sayılardır. Oyuncu kimlikleri (UUID) ve e-posta hiçbir zaman gönderilmez.

## 4. Kapanış kodları

| Kod | Anlam | İstemci davranışı |
|---|---|---|
| 4000 | Protokol hatası (ilk mesaj `hello` değil) | Yeniden bağlanır |
| 4001 | Bilet geçersiz/süresi dolmuş veya kaynak izinsiz | En fazla 3 deneme, sonra durur |
| 4002 | Aynı hesap başka cihazdan oyuna girdi | **Durur**, "Bu cihazda devam et" butonu gösterir |
| 4003 | Oturum sona erdi (çıkış, parola değişimi, yasak, doğrulama) | **Durur**, yeniden giriş ister |
| 4004 | Sunucu yeniden başlatılıyor | Yeniden bağlanır |
| 4008 | `hello` zaman aşımı | Yeniden bağlanır |
| 4009 | Saniyede çok fazla mesaj | Yeniden bağlanır |
| 4010 | Protokol sürümü eski | **Durur**, sayfanın yenilenmesini ister |

Yeniden bağlanma her denemede yeni bir bilet alır. Bekleme süreleri: 1, 2, 4, 8, 10, 10… sn. Tarayıcı çevrimdışıyken "online" olayı gelince hemen denenir.

## 5. Simülasyon, tahmin ve uzlaştırma

- **Ortak adım fonksiyonu `stepShip`:**
  - Hız asla gemi hızını aşmaz (sunucunun aktif konfigürasyondan hesapladığı değer).
  - Hızlanma yumuşatılır; yön değişimi 6 rad/sn ile sınırlıdır.
  - Konum harita sınırına kırpılır.
- **Sunucu, oyuncu başına:**
  - Her tikte kuyruktan **en fazla bir** girdi işler.
  - Kuyruk en fazla 20 girdiyi tutar; fazlası en eskiden atılır. Gerçek zamandan hızlı girdi gönderen istemci (hız hilesi) bu yüzden fazladan adım atamaz.
  - Girdi gelmeyen tikte son girdi tekrarlanır ve en fazla 4 tiklik "borç" tutulur. Geç gelen girdiler bu borcu öder, böylece adım sayısı istemciyle eşit kalır.
  - 4 tikten uzun kesintide yön girdisi durdurulur (sekme arka planda, bağlantı sorunu). Hedef noktaya gidiş devam eder.
- **İstemci tahmini:** Her 50 ms'de girdi üretir, `stepShip` ile hemen uygular ve gönderir.
- **İstemci uzlaştırması:** `snap` gelince:
  1. `seq ≤ a` girdiler atılır.
  2. Sunucu durumundan kalan girdiler yeniden oynatılır.
  3. Fark ≤ 300 birimse görsel olarak ~100 ms'de yumuşatılır; büyükse doğrudan atlanır.
- **Enterpolasyon:** Diğer pilotlar ~150 ms geriden, iki anlık görüntü arasında çizilir. Görüntü gecikirse en fazla 100 ms son yönde devam edilir.

## 6. İlgi alanı (AOI) ve görünürlük

- Harita 2000 birimlik ızgaraya bölünür. Her oyuncuya yalnızca **radar menzilindeki** (taban 1500 + gemi radar bonusu) diğer gemiler gönderilir.
- Menzil dışındaki pilot hile ile de görülemez, çünkü sunucu o veriyi hiç göndermez (madde 18).
- Mini harita radar dairesini ve menzildeki pilotları gösterir. Düşman şirket pilotları kırmızı halkayla işaretlenir. HUD'da "Radar" listesi ad ve mesafe gösterir.

## 7. Tek aktif oyun oturumu ve kopma

- Aynı pilot için yeni bağlantı kabul edilince Redis `game:kick` yayınlanır. Eski bağlantı **hangi süreçte olursa olsun** 4002 ile kapanır ve gemi yeni bağlantıya devredilir.
- **Kopma:** Bağlantısı kopan gemi `GAME_LINGER_SECONDS` (varsayılan 30 sn) boyunca haritada kalır; böylece savaştan bağlantıyı keserek kaçılamaz. Bu sürede geri dönülürse aynı gemi devam eder.
- **Oturum denetimi:** Oyun sunucusu 30 sn'de bir bağlı oturumları denetler. Çıkış yapılmış, süresi dolmuş, askıya alınmış veya yasaklanmış hesabın bağlantısı 4003 ile kapanır.

## 8. Kalıcılık ve canlı değişiklikler

| Veri | Ne zaman yazılır |
|---|---|
| Konum (`players.pos_x/pos_y`) | 5 sn'de bir toplu (değişenler), çıkışta hemen, sunucu kapanırken hepsi |
| Harita (`players.map_id`) + `map_transitions` | Geçit ve bakım taşımasında hemen (transaction) |
| `players.last_online_at` | Girişte ve çıkışta |
| Çevrimiçi durum (Redis `game:presence:<oyuncu>`, 30 sn TTL) | Girişte, harita/istasyon değişiminde, 5 sn'de bir yenilenir; çıkışta silinir |

- **Yalnızca istasyonda ekipman:** Oyuncu oyundayken ve istasyon bölgesinde değilken ekipman takma/çıkarma, gemi değiştirme, tasarım ve PET modülü işlemleri `409 NOT_IN_STATION` alır. Oyun dışındayken (web hangarı) serbesttir. Konfigürasyon değiştirme (K1/K2) her yerde serbesttir.
- **Canlı istatistik:** Hangarda yapılan her değişiklik (ekipman, konfigürasyon, gemi, tamir, yükseltme) `game:player-updated` yayınlar. Oyun sunucusu hız, can, kalkan ve radar değerlerini yeniden yükler ve istemciye `pilot` mesajı gönderir.
- **Bakım:** Oyun sunucusu 15 sn'de bir dolu haritaların `is_closed` durumunu denetler. Kapatılan haritadaki pilotlar şirket haritasına taşınır (`map` + `notice`).

## 9. Ölçülen ağ bütçesi

- **İndirme:** 10 pilot aynı bölgede birbirini görürken oyuncu başına en fazla **3,44 KB/s** (JSON). Bu değer `apps/api/test/game.test.ts` içindeki "ağ bütçesi" testinde ölçülür ve 15 KB/s hedefini aşarsa test başarısız olur.
- **Gönderme:** 20 girdi/sn × ~30 bayt ≈ 0,6 KB/s, artı WebSocket çerçeve başlıkları.
- **Yavaş bağlantı:** Bir istemcinin gönderim arabelleği 512 KB'ı aşarsa ona anlık görüntü atlanır. Bir sonraki görüntü zaten tam durumu taşır.

## 10. Sağlık ve izleme

- `GET http://127.0.0.1:4001/health` → `{ok, players, rooms, tick}`
- Günlük satırları JSON'dur (`svc: "game"`): giriş, çıkış, harita geçişi, hatalar.
