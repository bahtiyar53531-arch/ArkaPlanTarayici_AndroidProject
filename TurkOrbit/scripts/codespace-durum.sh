#!/usr/bin/env bash
# Türk Orbit — Codespaces: sunucu hazır olunca oyun linkini ve kısa talimatı gösterir.
RUN=/tmp/turkorbit
echo "Türk Orbit sunucusu hazırlanıyor… (ilk açılışta 3–6 dk sürebilir)"
for _ in $(seq 1 600); do
  [ -f "$RUN/hazir" ] || [ -f "$RUN/hata" ] && break
  sleep 1
done
if [ -f "$RUN/hata" ]; then
  echo ""
  echo "✖ Başlatma başarısız: $(cat "$RUN/hata")"
  echo "  Tekrar denemek için: bash TurkOrbit/scripts/codespace-baslat.sh"
  exit 1
fi
if [ ! -f "$RUN/hazir" ]; then
  echo "Henüz hazır değil. Birazdan tekrar çalıştır: bash TurkOrbit/scripts/codespace-durum.sh"
  exit 0
fi
URL="$(cat "$RUN/link")"
cat <<MSG

==================================================================
  TÜRK ORBIT ÇALIŞIYOR

  Oyun (tarayıcı):     $URL
  Android uygulaması:  "Sunucu adresi" ekranına aynı linki yaz
  Yönetim Merkezi:     $URL/yonetim/
  E-posta kutusu:      $(cat "$RUN/posta")
                       (kayıt doğrulama e-postası buraya düşer)
==================================================================
MSG
if [ "$(cat "$RUN/herkese-acik" 2>/dev/null)" != "evet" ]; then
  cat <<MSG
⚠ 8080 portu otomatik olarak herkese açık yapılamadı. APK'nın bağlanabilmesi için:
  Alttaki PORTS (Bağlantı noktaları) sekmesi → 8080 satırına uzun bas/sağ tıkla →
  Port Visibility → Public.
MSG
fi
cat <<MSG
Yönetici olmak için (kayıt olduktan sonra), bu terminale yaz:
  cd TurkOrbit && npm run admin:grant-role -- --user KULLANICI_ADIN --role super_admin --reason "Test"
Günlükler: $RUN/api.log  $RUN/oyun.log  $RUN/web.log
MSG
