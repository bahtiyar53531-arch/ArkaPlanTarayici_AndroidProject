# apps/admin — TÜRK ORBIT YÖNETİM MERKEZİ (Aşama 14)

Bu klasör **henüz kod içermez**. İşlevsiz buton bırakmamak için panel arayüzü, ilgili backend modülleri hazır olduğunda yazılacak.

Hazır olan altyapı (Aşama 1):
- Rol/yetki kataloğu ve veritabanı eşlemesi (9 rol, 48 yetki)
- Sunucu tarafı yetki koruması: `requirePermission('<yetki>')` (testli)
- Değiştirilemez yönetici işlem geçmişi: `admin_audit_log` (testli)
- Kayıt açma/kapama ayarı: `game_settings.registration.enabled` (testli)
- Sunucu tarafı rol atama aracı: `npm run admin:grant-role`

Modül planı: [Documentation/05-Yonetim-Merkezi-Plani.md](../../Documentation/05-Yonetim-Merkezi-Plani.md)
