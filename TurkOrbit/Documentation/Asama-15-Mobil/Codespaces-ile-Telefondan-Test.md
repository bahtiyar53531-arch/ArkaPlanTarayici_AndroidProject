# Telefondan Test: GitHub Codespaces + Android APK (PC gerekmez)

Bu rehber, bilgisayarın yokken yalnızca **Android telefonla** Türk Orbit'i denemen için. Oyun sunucusu GitHub'ın ücretsiz bulut makinesinde (Codespaces) çalışır ve sana gerçek bir `https://…app.github.dev` linki verir. Bu linki hem telefonun tarayıcısında hem de Android uygulamasında kullanırsın.

> **Dürüst not:**
> - Bu kurulum (`.devcontainer` + `scripts/codespace-*.sh`) Codespaces'ta henüz hiç çalıştırılmadı; ben Codespaces'a erişemiyorum.
> - Sunucu tarafı (derleme, veritabanı, tek port sunucusu, kayıt → e-posta doğrulama → giriş → oyuna bağlanma) aynı betikle başka bir Linux makinesinde denendi ve çalıştı.
> - İlk açılışta bir adım takılırsa ekrandaki hata metnini bana yaz.

## 0. Ne gerekiyor?
- GitHub hesabın (depo zaten senin).
- Android telefon, Chrome tarayıcısı.
- **Ücret:** Codespaces'ın aylık ücretsiz kotası var (kişisel hesapta 2 çekirdekli makineyle yaklaşık 60 saat). Kota dolarsa GitHub ücret almaz, makine durur.

## 1. APK'yı indir ve kur
1. APK'yı indir. İki yol var:
   - Sohbette gönderdiğim `TurkOrbit-0.15.0-test.apk` dosyasına dokun ve indir.
   - Ya da telefonda GitHub'a giriş yapılıyken şu sayfayı aç ve **Download** (indir) düğmesine bas: `https://github.com/bahtiyar53531-arch/ArkaPlanTarayici_AndroidProject/blob/ccr-4f8cba77-ej0zlw/TurkOrbit/Deliveries/TurkOrbit-0.15.0-test.apk`
2. İnen dosyaya dokun.
3. "Bu kaynaktan yüklemeye izin ver" uyarısı çıkarsa izin ver ve **Yükle**'ye bas.
4. Telefonda **"Türk Orbit Test"** uygulaması görünür. Şimdilik açma, önce sunucuyu başlat.

## 2. Sunucuyu başlat (Codespaces)
1. Telefonda Chrome ile şu linki aç (GitHub'a giriş yapmış ol):
   `https://codespaces.new/bahtiyar53531-arch/ArkaPlanTarayici_AndroidProject/tree/ccr-4f8cba77-ej0zlw?quickstart=1`
   - Sayfa mobilde açılmazsa: Chrome menüsü (⋮) → **Masaüstü sitesi**'ni işaretle → tekrar dene.
   - Elle yol: depo sayfası → dal seçicisinden `ccr-4f8cba77-ej0zlw` → yeşil **Code** → **Codespaces** → **Create codespace on ccr-…**.
2. **Create codespace**'e bas. İlk açılış **5–10 dakika** sürer. Sırayla şunlar olur:
   - veritabanı, Redis ve e-posta kutusu kurulur,
   - bağımlılıklar yüklenir,
   - oyun derlenir ve başlar.
3. Tarayıcıda VS Code açılır. Alttaki terminalde şuna benzer bir kutu çıkar:
   ```
   TÜRK ORBIT ÇALIŞIYOR
   Oyun (tarayıcı):     https://<codespace-adı>-8080.app.github.dev
   E-posta kutusu:      https://<codespace-adı>-8025.app.github.dev
   ```
   - Kutu görünmüyorsa terminali aç (☰ menü → Terminal → New Terminal) ve şunu yaz: `bash TurkOrbit/scripts/codespace-durum.sh`
4. **Oyun linkini kopyala.** Bu, tarayıcıda da uygulamada da kullanacağın adres.

## 3. Tarayıcıda oyna
1. Oyun linkini Chrome'da yeni sekmede aç → **Kayıt ol** (kullanıcı adı, e-posta, parola).
2. Doğrulama e-postası gerçek e-posta adresine **gitmez**. Bu test sunucusunun kendi **e-posta kutusuna** düşer:
   1. Terminaldeki "E-posta kutusu" linkini aç (GitHub girişi ister).
   2. Gelen "doğrula" e-postasındaki bağlantıya dokun → "E-posta adresin doğrulandı".
3. Oyun linkine dön → **Giriş yap** → pilotunu oluştur → **Oyna**. Telefonu yan çevirince oyun yatay düzene geçer.

## 4. Android uygulamasında oyna
1. "Türk Orbit Test"i aç → **Sunucu adresi** ekranına oyun linkini yapıştır → **Bağlan**.
2. Aynı hesapla giriş yap → **Oyna**.
3. **"Sunucuya ulaşılamadı" derse** 8080 portu herkese açık değildir. Codespaces'ta:
   1. Alttaki **PORTS** (Bağlantı noktaları) sekmesini aç.
   2. **8080** satırına uzun bas (veya sağ tıkla) → **Port Visibility** → **Public**.
   3. Uygulamada tekrar **Bağlan**'a bas.

**Kontrol listesi** (sonucu bana yaz; rapora gerçek cihaz sonucu olarak işlerim): [Mobil-Derleme-ve-Cihaz-Testi.md §3](Mobil-Derleme-ve-Cihaz-Testi.md). PC adımları yerine:
- **İkinci oyuncu:** İkinci bir cihaz (ya da bir arkadaşın telefonu) aynı oyun linkini tarayıcıda açıp başka bir hesapla aynı haritaya girebilir. Uygulamadaki pilotunla birbirinizi görmeniz gerekir.
- **Oturum listesi:** Aynı hesapla tarayıcıdan Hesap → Güvenlik sayfasında "Android · telefon modelin" oturumu görünür.

## 5. Yönetim Merkezi (isteğe bağlı)
1. Kayıt olduktan sonra Codespaces terminaline yaz:
   ```bash
   cd TurkOrbit && npm run admin:grant-role -- --user KULLANICI_ADIN --role super_admin --reason "Test"
   ```
2. Panel: oyun linkinin sonuna `/yonetim/` ekle.
3. Örnek deneme: İçerik → Ayarlar → **Mobil uygulama sürümü** → Android en düşük sürümü `0.16.0` yap → yayınla. Uygulamada "Güncelleme gerekli" ekranı çıkar; geri alınca "Tekrar dene" ile açılır.

## 6. Bilmen gerekenler
- **Link herkese açık:**
  - Port 8080 "Public" iken linki bilen herkes oyuna girebilir. Bu bir test sunucusu; içindeki veriler yalnızca test verisi.
  - İşin bitince Codespace'i durdur: github.com/codespaces → codespace'in yanındaki ⋯ → **Stop codespace**.
- **Kendiliğinden durma:**
  - Codespace, varsayılan olarak 30 dakika işlem yapılmazsa durur.
  - Süreyi github.com → Settings → Codespaces → **Default idle timeout** ile 240 dakikaya kadar uzatabilirsin.
  - Yeniden açınca (aynı linkle, `?quickstart=1` var olanı açar) sunucu kendiliğinden yeniden başlar. Hesaplar ve pilotlar korunur.
- **Link değişirse:** Yeni bir codespace açarsan link değişir. Uygulamada giriş ekranının altındaki **Sunucu: … · Değiştir** ile yeni linki gir.
- **Hata olursa:**
  - Terminalde `bash TurkOrbit/scripts/codespace-baslat.sh` sunucuyu yeniden başlatır.
  - Günlükler: `/tmp/turkorbit/api.log`, `oyun.log`, `web.log`, `derleme.log`.
