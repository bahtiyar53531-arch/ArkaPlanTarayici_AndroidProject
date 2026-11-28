package com.turkorbit.oyun;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Oturum anahtarı gibi küçük gizli değerler için cihaz içi güvenli depo (Aşama 15).
 *
 * - Şifreleme anahtarı Android Keystore'da üretilir (AES-256, GCM). Anahtar uygulamadan dışarı çıkarılamaz;
 *   cihaz destekliyorsa donanım (TEE) içinde tutulur.
 * - Şifreli değer ve rastgele IV, uygulamaya özel SharedPreferences dosyasında saklanır. Değerin adı ek doğrulama
 *   verisi (AAD) olarak şifrelemeye bağlanır: bir değerin şifreli metni başka bir adla okunamaz.
 * - Okunamayan değer (anahtar silinmiş, dosya yedekten dönmüş veya bozulmuş) silinir ve "yok" sayılır; oyuncu
 *   yeniden giriş yapar. Uygulama yedeklemesi manifestte kapalıdır.
 */
final class SecureStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "turkorbit.securestore.v1";
    private static final String PREFS = "turkorbit_secure_store";
    private static final String PREFIX = "v1.";
    private static final String CIPHER = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;

    private final SharedPreferences prefs;

    SecureStore(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isValidName(String name) {
        return name != null && name.matches("[A-Za-z0-9_.-]{1,64}");
    }

    private static SecretKey key() throws GeneralSecurityException, java.io.IOException {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }

    synchronized void set(String name, String value) throws Exception {
        Cipher cipher = Cipher.getInstance(CIPHER);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        if (!prefs.edit().putString(PREFIX + name, stored).commit()) {
            throw new IllegalStateException("Güvenli depoya yazılamadı.");
        }
    }

    /** Değer yoksa veya okunamıyorsa null. */
    synchronized String get(String name) {
        String stored = prefs.getString(PREFIX + name, null);
        if (stored == null) return null;
        try {
            int sep = stored.indexOf(':');
            if (sep <= 0) throw new IllegalArgumentException("biçim");
            byte[] iv = Base64.decode(stored.substring(0, sep), Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(stored.substring(sep + 1), Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception e) {
            // Bozuk/okunamayan değer saklanmaz: bir sonraki girişte yenisi yazılır
            prefs.edit().remove(PREFIX + name).commit();
            return null;
        }
    }

    synchronized void remove(String name) {
        prefs.edit().remove(PREFIX + name).commit();
    }
}
