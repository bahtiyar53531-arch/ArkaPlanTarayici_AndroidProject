#!/usr/bin/env bash
# Türk Orbit — Codespaces başlatma (codespace her açıldığında):
#   .env üretir (gizli anahtar bir kez üretilip korunur) → derler → veritabanını günceller →
#   API (4000), oyun sunucusu (4001) ve tek port sunucusunu (8080) arka planda başlatır → 8080'i herkese açık yapar.
# Oyun linki: bash TurkOrbit/scripts/codespace-durum.sh
set -uo pipefail
cd "$(dirname "$0")/.."
RUN=/tmp/turkorbit
mkdir -p "$RUN"
rm -f "$RUN/hazir" "$RUN/hata"
exec > >(tee "$RUN/baslat.log") 2>&1

fail() { echo "✖ $1" | tee "$RUN/hata"; exit 1; }

DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-8080.${DOMAIN}"
  MAILPIT="https://${CODESPACE_NAME}-8025.${DOMAIN}"
else
  URL="http://localhost:8080"
  MAILPIT="http://localhost:8025"
fi

# ---------------------------------------------------------------- .env
SECRET=""
[ -f .env ] && SECRET="$(grep -E '^CSRF_SECRET=' .env | cut -d= -f2- || true)"
[ -n "$SECRET" ] || SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
cat > .env <<ENV
# Codespaces için otomatik üretildi (scripts/codespace-baslat.sh). Depoya girmez.
NODE_ENV=production
HOST=127.0.0.1
PORT=4000
GAME_PORT=4001
DATABASE_URL=postgres://turkorbit:turkorbit_dev@127.0.0.1:5432/turkorbit
REDIS_URL=redis://127.0.0.1:6379/0
PUBLIC_WEB_URL=${URL}
# Oyun sitesi + Android uygulaması (https://localhost) + iOS uygulaması (capacitor://localhost)
ALLOWED_ORIGINS=${URL},https://localhost,capacitor://localhost
CSRF_SECRET=${SECRET}
SMTP_URL=smtp://127.0.0.1:1025
TRUST_PROXY=true
LOG_LEVEL=info
ENV
echo "✔ .env hazır (sunucu adresi: ${URL})"

# ---------------------------------------------------------------- servisler
wait_port() {
  for _ in $(seq 1 90); do (echo > "/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 1; done
  return 1
}
wait_port 5432 || fail "PostgreSQL açılmadı (5432)."
wait_port 6379 || fail "Redis açılmadı (6379)."
echo "✔ PostgreSQL ve Redis hazır"

[ -d node_modules ] || npm ci --no-audit --no-fund || fail "npm ci başarısız."
echo "▶ Derleniyor (1–3 dk)…"
npm run build > "$RUN/derleme.log" 2>&1 || fail "Derleme başarısız; ayrıntı: $RUN/derleme.log"
echo "✔ Derlendi"
npm run db:migrate > "$RUN/migration.log" 2>&1 || fail "Veritabanı güncellenemedi; ayrıntı: $RUN/migration.log"
echo "✔ Veritabanı güncel"

# Önceki çalışmadan kalan süreçler
for p in api oyun web; do
  [ -f "$RUN/$p.pid" ] && kill "$(cat "$RUN/$p.pid")" 2>/dev/null
  rm -f "$RUN/$p.pid"
done
sleep 1

start() { # ad, klasör, komut…  (süreç oturumdan ayrılır; hiçbir tanıtıcı bu betiğe bağlı kalmaz → betik biter)
  local name=$1 dir=$2; shift 2
  ( cd "$dir" || exit 1; exec setsid nohup "$@" < /dev/null > "$RUN/$name.log" 2>&1 ) &
  echo $! > "$RUN/$name.pid"
}
start api apps/api node --env-file-if-exists=../../.env dist/index.js
start oyun apps/api node --env-file-if-exists=../../.env dist/game/index.js
start web . node scripts/tek-port-sunucu.mjs

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null http://127.0.0.1:8080/api/v1/health 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null http://127.0.0.1:8080/api/v1/health || fail "Sunucu yanıt vermiyor; günlükler: $RUN/api.log, $RUN/oyun.log, $RUN/web.log"

# ---------------------------------------------------------------- 8080'i herkese açık yap (APK ve giriş yapmamış tarayıcı için)
PUBLIC="evet"
if [ -n "${CODESPACE_NAME:-}" ]; then
  gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" > "$RUN/port.log" 2>&1 || PUBLIC="hayır"
fi
echo "$URL" > "$RUN/link"
echo "$MAILPIT" > "$RUN/posta"
echo "$PUBLIC" > "$RUN/herkese-acik"
touch "$RUN/hazir"
echo "✔ Türk Orbit çalışıyor: $URL"
