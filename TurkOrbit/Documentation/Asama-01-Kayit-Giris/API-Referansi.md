# Aşama 1 — Kimlik Doğrulama API Referansı

**Temel adres:** `/api/v1` · **İçerik türü:** yalnızca `application/json` (başka türler `415` döner)

## Ortak kurallar

| Konu | Kural |
|---|---|
| Web oturumu | `POST /auth/login` (varsayılan `transport: "cookie"`) → `to_sid` (üretimde `__Host-to_sid`) HttpOnly + SameSite=Strict çerezi. Yanıttaki `csrfToken` değeri, durum değiştiren her istekte `X-CSRF-Token` başlığına konur. |
| Uygulama oturumu (Android/iOS/masaüstü) | `transport: "token"` → yanıtta `sessionToken`. İsteklerde `Authorization: Bearer <sessionToken>` kullanılır. CSRF gerekmez. |
| Platform bilgisi | İsteğe bağlı `X-Client-Platform: web|android|ios|windows|macos|linux` |
| Origin | Durum değiştiren isteklerde `Origin` başlığı varsa `ALLOWED_ORIGINS` listesinde olmalı (yoksa `403 ORIGIN_NOT_ALLOWED`). |
| Hata biçimi | `{"error":{"code":"…","message":"Türkçe mesaj","fields":{"alan":["…"]},"retryAfterSeconds":60}}` |
| Hız sınırı | `429 RATE_LIMITED` + `Retry-After` başlığı |

## Uç noktalar

| Yöntem | Yol | Oturum | Gövde | Başarılı yanıt |
|---|---|---|---|---|
| GET | `/health` | – | – | `200 {status, database, redis, uptimeSeconds}` |
| POST | `/auth/register` | – | `{username, email, password, acceptTerms: true, locale?}` | `201 {status:"pending_verification", message}` |
| POST | `/auth/verify-email` | – | `{token}` | `200 {status:"verified", username, message}` |
| POST | `/auth/resend-verification` | ✔ | `{}` | `200 {status:"sent"|"already_verified"}` |
| POST | `/auth/login` | – | `{identifier, password, transport?, device?: {platform, name?, appVersion?}}` | `200 {user, permissions, csrfToken, session, suspicious, sessionToken?}` |
| POST | `/auth/logout` | ✔ | `{}` | `200 {status:"logged_out"}` |
| GET | `/auth/me` | ✔ | – | `200 {user, permissions, csrfToken, session}` |
| POST | `/auth/password/forgot` | – | `{email}` | `202 {status:"accepted"}` (hesap olsa da olmasa da aynı) |
| POST | `/auth/password/reset` | – | `{token, newPassword}` | `200` — tüm oturumlar kapatılır |
| POST | `/auth/password/change` | ✔ | `{currentPassword, newPassword}` | `200 {revokedOtherSessions}` — mevcut oturum açık kalır |
| GET | `/auth/sessions` | ✔ | – | `200 {sessions:[{id, platform, deviceName, browser, os, ipMasked, createdAt, lastSeenAt, expiresAt, current}]}` |
| DELETE | `/auth/sessions/:id` | ✔ | – | `200 {status:"revoked", current}` |
| POST | `/auth/sessions/revoke-others` | ✔ | `{}` | `200 {revoked}` |
| GET | `/auth/login-history` | ✔ | – | `200 {events:[{success, failureReason, platform, browser, os, ipMasked, suspicious, suspiciousReasons, createdAt}]}` (son 50) |

## Hata kodları

| Kod | HTTP | Ne zaman |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Eksik/geçersiz alan, **izin verilmeyen alan** (ör. `role`), bozuk JSON |
| `WEAK_PASSWORD` | 400 | Parola politikası (≥10 karakter, yaygın parola değil, kullanıcı adı/e-posta içermez, <16 karakterse ≥2 karakter türü) |
| `USERNAME_TAKEN` | 409 | Kullanıcı adı alınmış |
| `INVALID_CREDENTIALS` | 401 | Hatalı kimlik bilgisi (hesap olsa da olmasa da aynı yanıt) |
| `ACCOUNT_BANNED` / `ACCOUNT_SUSPENDED` / `ACCOUNT_LOCKED` | 403 | Yalnızca parola doğruysa gösterilir |
| `INVALID_TOKEN` / `TOKEN_EXPIRED` | 400 | Doğrulama/sıfırlama bağlantısı |
| `UNAUTHENTICATED` | 401 | Oturum yok, süresi dolmuş, iptal edilmiş veya 7 gün kullanılmamış |
| `FORBIDDEN` | 403 | Yetki yok (RBAC) |
| `CSRF_FAILED` | 403 | Çerez oturumunda `X-CSRF-Token` eksik veya yanlış |
| `ORIGIN_NOT_ALLOWED` | 403 | İzinsiz Origin |
| `RATE_LIMITED` | 429 | Hız sınırı veya 5 hatalı denemeden sonraki 15 dk'lık kilit |
| `REGISTRATION_CLOSED` | 403 | `game_settings.registration.enabled = false` |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | JSON dışı gövde |

## Hız sınırları (varsayılan)

| İşlem | Sınır |
|---|---|
| Giriş (IP başına) | 30 / 15 dk |
| Hatalı giriş (hesap veya denenen ad başına) | 5 / 15 dk → kilit + sahibine e-posta |
| Kayıt (IP başına) | 5 / saat |
| Şifremi unuttum | IP başına 10 / saat, e-posta başına 3 / saat (sessiz) |
| Doğrulama e-postası yeniden gönderme | Kullanıcı başına 3 / saat |
| Parola değiştirme | Kullanıcı başına 5 / 15 dk |

## Örnek (curl, mobil uygulama gibi)

```bash
curl -s http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' -H 'X-Client-Platform: android' \
  -d '{"identifier":"AnadoluKartali","password":"Kizilelma_Seferi_1071","transport":"token","device":{"platform":"android","name":"Pixel 8"}}'

curl -s http://localhost:4000/api/v1/auth/me -H "Authorization: Bearer <sessionToken>"
```
