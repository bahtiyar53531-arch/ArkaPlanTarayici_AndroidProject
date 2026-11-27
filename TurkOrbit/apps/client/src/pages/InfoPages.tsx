import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { Alert, Card } from '../components/ui';

const DRAFT_NOTE = (
  <Alert kind="warning">
    Bu metin <b>taslaktır</b>. Yayından önce şirket bilgileriyle tamamlanmalı ve hukuki incelemeden geçirilmelidir.
  </Alert>
);

export function TermsPage() {
  return (
    <PublicLayout>
      <Card title="Kullanım Koşulları (Taslak)">
        {DRAFT_NOTE}
        <div className="prose">
          <h2>1. Hesap</h2>
          <p>Her oyuncu tek bir hesaptan sorumludur. Hesap bilgilerini kimseyle paylaşma; hesabındaki tüm işlemlerden sen sorumlusun.</p>
          <h2>2. Adil oyun</h2>
          <p>
            Bot, makro, otomatik oynatıcı, hile yazılımı, oyun istemcisini veya ağ trafiğini değiştiren araçlar ve oyun hatalarının
            kötüye kullanımı yasaktır. Sunucu tüm kritik hesaplamaları kendisi yapar ve şüpheli davranışları kaydeder.
          </p>
          <h2>3. Davranış kuralları</h2>
          <p>Hakaret, nefret söylemi, taciz, dolandırıcılık ve resmî/yetkili kişileri taklit etmek yasaktır.</p>
          <h2>4. Yaptırımlar</h2>
          <p>Kural ihlallerinde uyarı, geçici askıya alma veya kalıcı yasak uygulanabilir. Her yaptırım kayıt altına alınır ve itiraz edilebilir.</p>
          <h2>5. Değişiklikler</h2>
          <p>Koşullar güncellendiğinde sürüm numarası değişir ve oyunculara bildirilir.</p>
        </div>
        <Link className="btn btn-secondary" to="/kayit">
          Kayıt sayfasına dön
        </Link>
      </Card>
    </PublicLayout>
  );
}

export function PrivacyPage() {
  return (
    <PublicLayout>
      <Card title="KVKK Aydınlatma Metni (Taslak)">
        {DRAFT_NOTE}
        <div className="prose">
          <h2>Veri sorumlusu</h2>
          <p>Türk Orbit işletmecisi (unvan ve adres bilgisi yayından önce eklenecektir). İletişim: destek@turkorbit.com</p>
          <h2>İşlenen kişisel veriler</h2>
          <ul>
            <li>Kimlik/hesap: kullanıcı adı, e-posta adresi</li>
            <li>Güvenlik: parolanın geri döndürülemez Argon2id özeti (parolanın kendisi saklanmaz)</li>
            <li>İşlem güvenliği: IP adresi, cihaz/tarayıcı türü, giriş geçmişi, aktif oturumlar</li>
          </ul>
          <h2>Amaçlar ve hukuki sebep</h2>
          <p>
            Hesabın oluşturulması ve oyun hizmetinin sunulması (sözleşmenin ifası), hesap güvenliğinin sağlanması, hile ve kötüye
            kullanımın önlenmesi (meşru menfaat) ve yasal yükümlülüklerin yerine getirilmesi.
          </p>
          <h2>Saklama süreleri</h2>
          <p>Kapanmış oturum kayıtları 90 gün sonra, kullanılmış/süresi dolmuş tek kullanımlık bağlantılar 7 gün sonra silinir.</p>
          <h2>Haklarınız</h2>
          <p>KVKK md. 11 kapsamındaki haklarını kullanmak için destek@turkorbit.com adresine başvurabilirsin.</p>
        </div>
        <Link className="btn btn-secondary" to="/kayit">
          Kayıt sayfasına dön
        </Link>
      </Card>
    </PublicLayout>
  );
}

export function NotFoundPage() {
  return (
    <PublicLayout>
      <Card title="Kayıp sektör" subtitle="Aradığın sayfa bu galakside bulunamadı.">
        <Link className="btn btn-primary" to="/">
          Ana sayfaya dön
        </Link>
      </Card>
    </PublicLayout>
  );
}
