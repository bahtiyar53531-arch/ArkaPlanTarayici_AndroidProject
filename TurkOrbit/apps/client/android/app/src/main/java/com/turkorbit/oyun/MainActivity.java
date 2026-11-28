package com.turkorbit.oyun;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Uygulamanın kendi yerel eklentisi (oturum anahtarı için Keystore tabanlı güvenli depo)
        registerPlugin(SecureStorePlugin.class);
        super.onCreate(savedInstanceState);

        // YALNIZCA test derlemesinde (debug APK): sayfa https://localhost kökünden açılır; yerel ağdaki geliştirme
        // sunucusuna (http://192.168.x.x:5173) bağlanabilmek için karışık içeriğe izin verilir. Düz HTTP izni de
        // manifestte yalnızca debug için açıktır. Sürüm derlemesinde (Play/AAB) ikisi de kapalıdır: yalnızca HTTPS/WSS.
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable && getBridge() != null) {
            getBridge().getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }
}
