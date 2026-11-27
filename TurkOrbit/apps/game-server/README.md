# apps/game-server — Gerçek zamanlı oyun sunucusu (Aşama 8)

Bu klasör **henüz kod içermez**. Aşama 8'de burada geliştirilecek:

- WebSocket sunucusu (`/ws`), API'nin verdiği tek kullanımlık **oyun bileti** ile kimlik doğrulama
- Harita başına 20 Hz sunucu otoriteli simülasyon (hareket, hedefleme, lazer/roket, hasar, ölüm, ödül)
- `packages/shared/protocol` ikili mesaj protokolü
- İlgi alanı (AOI) filtresi, delta anlık görüntüler
- Redis ile harita devri, sohbet/grup pub/sub, içerik sıcak yenileme (`content:updated`)

Tasarım: [Documentation/02-Teknik-Mimari.md §4](../../Documentation/02-Teknik-Mimari.md)
