# Görsel üretici

`gen.js`, ORBITRAGAME.SPACE simgelerini ve görsellerini SVG'den PNG'ye
(Chromium ile) üretir: adaptive icon katmanları (5 yoğunluk), eski tip
kare/yuvarlak simgeler, Play Store simgesi, tanıtım görseli, uzay arka planı.

```bash
npm install playwright@1.63.0
npx playwright install chromium
node gen.js ./cikti ../../app/src/main/res/font/orbitron_black.ttf
```

Üretilen `mipmap-*` klasörleri `app/src/main/res/` altına kopyalanır.
`bg_space.png` WebP'ye çevrilip `drawable-nodpi/bg_space.webp` olarak kullanılır.
