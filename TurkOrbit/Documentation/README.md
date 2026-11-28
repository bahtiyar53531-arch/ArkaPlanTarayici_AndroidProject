# Türk Orbit Belgeleri

| # | Belge | İçerik |
|---|---|---|
| 00 | [Çalışma Klasörü Analizi](00-Calisma-Klasoru-Analizi.md) | Depodaki mevcut dosyalar, ortam, workflow uyarısı |
| 01 | [Araştırma Raporu](01-Arastirma-Raporu.md) | 24 sistemin işlevsel analizi, kaynak erişim durumu, belirsizlikler |
| 02 | [Teknik Mimari](02-Teknik-Mimari.md) | Bileşenler, kimlik doğrulama, multiplayer tasarımı, canlı içerik güncelleme, güvenlik |
| 03 | [Platform Mimarisi](03-Platform-Mimarisi.md) | PC/web/Android/iOS ortak sistem, kontroller, HUD, performans, cihaz test matrisi |
| 04 | [Veritabanı Taslağı](04-Veritabani-Taslagi.md) | Uygulanan tablolar + tüm oyun için doğrulanmış taslak |
| 05 | [Yönetim Merkezi Planı](05-Yonetim-Merkezi-Plani.md) | 15.1–15.15 modülleri, rol-yetki matrisi |
| 06 | [Klasör Yapısı](06-Klasor-Yapisi.md) | Monorepo düzeni |
| 07 | [Geliştirme Aşamaları ve Test Planı](07-Gelistirme-Asamalari-ve-Test-Plani.md) | 17 aşama, kabul ölçütleri, test stratejisi |
| 08 | [Özgün Dünya Taslağı](08-Ozgun-Dunya-Taslagi.md) | Şirketler, para birimleri, haritalar, gemiler, NPC aileleri, Yıldız Kapıları |

## Aşama klasörleri
- [Asama-01-Kayit-Giris/](Asama-01-Kayit-Giris/): API referansı, kurulum ve dosya yerleştirme rehberi
- [Asama-05-Oyuncu-Profili/](Asama-05-Oyuncu-Profili/): profil API referansı, güncelleme rehberi
- [Asama-06-Hangar-Ekipman/](Asama-06-Hangar-Ekipman/): hangar ve mağaza API referansı, güncelleme rehberi
- [Asama-07-Harita-Oyun-Motoru/](Asama-07-Harita-Oyun-Motoru/): dünya/geçit/ayar API referansı, güncelleme rehberi, kontroller
- [Asama-08-Multiplayer/](Asama-08-Multiplayer/): gerçek zamanlı oyun protokolü, oyun sunucusu kurulumu (nginx, systemd)
- [Asama-09-NPC-Savas/](Asama-09-NPC-Savas/): savaş kuralları, NPC yapay zekâsı, protokol v2 ekleri, güncelleme rehberi
- [Asama-10-Gorev-Sistemi/](Asama-10-Gorev-Sistemi/): görev kuralları, içerik, API, güncelleme rehberi
- [Asama-11-Ekonomi/](Asama-11-Ekonomi/): kaynaklar, madencilik, üretim, açık artırma, günlük ödül, paketler, API, güncelleme rehberi
- [Asama-12-Klan-Sosyal/](Asama-12-Klan-Sosyal/): klan, rütbe, hazine, diplomasi, grup, sohbet kanalları, arkadaşlık, engelleme, bildirimler, şikâyet, protokol ve API, güncelleme rehberi

## Geliştirme notları
- [DevelopmentNotes/Asama-01-Raporu.md](DevelopmentNotes/Asama-01-Raporu.md): Aşama 1–4 raporu ve değişiklik raporu
- [DevelopmentNotes/Asama-05-Raporu.md](DevelopmentNotes/Asama-05-Raporu.md): Aşama 5 (oyuncu profili) raporu
- [DevelopmentNotes/Asama-06-Raporu.md](DevelopmentNotes/Asama-06-Raporu.md): Aşama 6 (hangar ve ekipman) raporu
- [DevelopmentNotes/Asama-07-Raporu.md](DevelopmentNotes/Asama-07-Raporu.md): Aşama 7 (harita ve oyun motoru) raporu
- [DevelopmentNotes/Asama-08-Raporu.md](DevelopmentNotes/Asama-08-Raporu.md): Aşama 8 (çok oyunculu) raporu
- [DevelopmentNotes/Asama-09-Raporu.md](DevelopmentNotes/Asama-09-Raporu.md): Aşama 9 (NPC ve savaş) raporu
- [DevelopmentNotes/Asama-10-Raporu.md](DevelopmentNotes/Asama-10-Raporu.md): Aşama 10 (görev sistemi) raporu
- [DevelopmentNotes/Asama-11-Raporu.md](DevelopmentNotes/Asama-11-Raporu.md): Aşama 11 (ekonomi) raporu
- [DevelopmentNotes/Asama-12-Raporu.md](DevelopmentNotes/Asama-12-Raporu.md): Aşama 12 (klan ve sosyal) raporu
- [DevelopmentNotes/Karar-Gunlugu.md](DevelopmentNotes/Karar-Gunlugu.md): mimari kararlar ve gerekçeleri
- [DevelopmentNotes/ekran-goruntuleri/](DevelopmentNotes/ekran-goruntuleri/): otomatik arayüz testinin ekran görüntüleri
