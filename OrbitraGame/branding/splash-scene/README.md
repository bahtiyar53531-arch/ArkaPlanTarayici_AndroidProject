# Açılış videosu sahnesi

`scene.html`, açılış videosunu ve arayüzdeki gerçekçi görselleri üreten 3B sahnedir
(three.js 0.170.0): mor-mavi bulutsu, atmosferli gezegen, kahverengi asteroitler,
motor izli uzay gemileri, bloom ışıma. Zaman deterministiktir ve 8 saniyede
kesintisiz döngü yapar.

```bash
npm install three@0.170.0 playwright@1.63.0
node render.js 1080 1920 video kareler_dikey 30 8
node render.js 1920 1080 video kareler_yatay 30 8
ffmpeg -framerate 30 -i kareler_dikey/f%04d.jpg -vf "hqdn3d=6:4:8:6" -c:v libx264 -profile:v high \
  -level 4.0 -pix_fmt yuv420p -crf 27 -preset slow -movflags +faststart -an splash_portrait.mp4
```

Çıktılar: `app/src/main/res/raw/splash_portrait.mp4`, `splash_landscape.mp4`,
`drawable-nodpi/bg_space.webp` (dikey kare), `drawable-land-nodpi/bg_space.webp`
(yatay kare), `drawable-nodpi/panel_blur.webp` (bulanık panel dokusu).
