package com.turkorbit.oyun;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.Map;

/**
 * Cihaz testi: Android Keystore yalnızca gerçek cihazda/emülatörde vardır.
 * Çalıştırmak için telefon USB ile bağlıyken: cd apps/client/android && ./gradlew connectedDebugAndroidTest
 */
@RunWith(AndroidJUnit4.class)
public class SecureStoreTest {
    private Context context;
    private SecureStore store;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        store = new SecureStore(context);
        store.remove("session");
        store.remove("other");
    }

    @Test
    public void paketAdiDogru() {
        assertTrue(context.getPackageName().startsWith("com.turkorbit.oyun"));
    }

    @Test
    public void yazOkuSil() throws Exception {
        assertNull(store.get("session"));
        store.set("session", "anahtar-1");
        assertEquals("anahtar-1", store.get("session"));
        store.set("session", "anahtar-2");
        assertEquals("anahtar-2", new SecureStore(context).get("session"));
        store.remove("session");
        assertNull(store.get("session"));
    }

    @Test
    public void degerDiskteAcikMetinOlarakDurmaz() throws Exception {
        String secret = "cok-gizli-oturum-anahtari-1234567890";
        store.set("session", secret);
        SharedPreferences prefs = context.getSharedPreferences("turkorbit_secure_store", Context.MODE_PRIVATE);
        for (Map.Entry<String, ?> e : prefs.getAll().entrySet()) {
            assertFalse(String.valueOf(e.getValue()).contains(secret));
        }
    }

    @Test
    public void baskaAdaTasinanSifreliDegerOkunamaz() throws Exception {
        store.set("session", "anahtar");
        SharedPreferences prefs = context.getSharedPreferences("turkorbit_secure_store", Context.MODE_PRIVATE);
        String raw = prefs.getString("v1.session", null);
        prefs.edit().putString("v1.other", raw).commit();
        assertNull(store.get("other"));
        assertEquals("anahtar", store.get("session"));
    }

    @Test
    public void bozulmusDegerSilinirVeYokSayilir() throws Exception {
        store.set("session", "anahtar");
        SharedPreferences prefs = context.getSharedPreferences("turkorbit_secure_store", Context.MODE_PRIVATE);
        prefs.edit().putString("v1.session", "AAAA:BBBB").commit();
        assertNull(store.get("session"));
        assertNull(prefs.getString("v1.session", null));
    }

    @Test
    public void anahtarAdiDenetlenir() {
        assertTrue(SecureStore.isValidName("session"));
        assertFalse(SecureStore.isValidName(""));
        assertFalse(SecureStore.isValidName("../x"));
        assertFalse(SecureStore.isValidName(null));
    }
}
