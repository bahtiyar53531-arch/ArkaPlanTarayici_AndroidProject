/** Kullanıcıya gösterilen Türkçe etiketler (istemci ve e-postalar ortak kullanır). */
export const SUSPICIOUS_REASON_LABELS_TR: Record<string, string> = {
  new_device: 'Daha önce kullanılmamış cihaz/tarayıcı',
  new_network: 'Daha önce görülmemiş ağ/konum',
  recent_failed_attempts: 'Girişten hemen önce çok sayıda hatalı deneme',
};

export const LOGIN_FAILURE_LABELS_TR: Record<string, string> = {
  wrong_password: 'Hatalı parola',
  unknown_account: 'Hesap bulunamadı',
  account_deleted: 'Silinmiş hesap',
  locked_out: 'Çok fazla hatalı deneme (geçici kilit)',
  account_banned: 'Yasaklı hesap',
  account_suspended: 'Askıya alınmış hesap',
  account_locked: 'Güvenlik kilidi',
};
