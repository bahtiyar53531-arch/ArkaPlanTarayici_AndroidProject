# apps/admin — TÜRK ORBIT YÖNETİM MERKEZİ (Aşama 14)

Yetki tabanlı yönetim paneli. Ayrı bir uygulamadır ama **ayrı bir hesap sistemi yoktur**: oyuncu hesabıyla aynı oturum ve aynı API (`/api/v1/admin/*`) kullanılır. Yetkiler yalnızca sunucuda denetlenir; arayüz menüyü gizlemek için `/auth/me` yetkilerini kullanır.

- Geliştirme: `npm run dev:admin` → http://localhost:5175/yonetim/ (API 4000; `ALLOWED_ORIGINS` içinde `http://localhost:5175` olmalı)
- Üretim: `npm run build` → `apps/admin/dist` → nginx `location /yonetim/` (bkz. `infra/nginx/turkorbit.conf.example`)
- İlk Süper Yönetici: `npm run admin:grant-role -- --user <ad> --role super_admin --reason "İlk kurulum"`

Kurallar, modüller ve uçlar: [Documentation/Asama-14-Yonetim-Merkezi/Yonetim-Merkezi-Kurallari-ve-API.md](../../Documentation/Asama-14-Yonetim-Merkezi/Yonetim-Merkezi-Kurallari-ve-API.md)
