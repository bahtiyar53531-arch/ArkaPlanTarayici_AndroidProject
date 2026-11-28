package com.turkorbit.oyun;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JavaScript tarafı: apps/client/src/platform/secure-store.ts (registerPlugin('TurkOrbitSecureStore')).
 * Değerler hiçbir zaman günlüğe yazılmaz.
 */
@CapacitorPlugin(name = "TurkOrbitSecureStore")
public class SecureStorePlugin extends Plugin {
    private static final int MAX_VALUE_LENGTH = 4096;
    private SecureStore store;

    @Override
    public void load() {
        store = new SecureStore(getContext());
    }

    private String name(PluginCall call) {
        String key = call.getString("key");
        if (!SecureStore.isValidName(key)) {
            call.reject("Geçersiz anahtar adı.", "INVALID_KEY");
            return null;
        }
        return key;
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = name(call);
        if (key == null) return;
        String value = store.get(key);
        JSObject result = new JSObject();
        result.put("value", value == null ? JSObject.NULL : value);
        call.resolve(result);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = name(call);
        if (key == null) return;
        String value = call.getString("value");
        if (value == null || value.isEmpty() || value.length() > MAX_VALUE_LENGTH) {
            call.reject("Geçersiz değer.", "INVALID_VALUE");
            return;
        }
        try {
            store.set(key, value);
            call.resolve();
        } catch (Exception e) {
            call.reject("Güvenli depoya yazılamadı.", "WRITE_FAILED");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = name(call);
        if (key == null) return;
        store.remove(key);
        call.resolve();
    }
}
