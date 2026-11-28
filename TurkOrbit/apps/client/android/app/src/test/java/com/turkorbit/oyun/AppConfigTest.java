package com.turkorbit.oyun;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * JVM birim testi (cihaz gerekmez): ./gradlew testDebugUnitTest
 * Derleme yapılandırmasının güvenlik açısından kritik kısımlarını denetler.
 */
public class AppConfigTest {
    private static String read(String path) throws Exception {
        Path p = Paths.get(path);
        if (!Files.exists(p)) p = Paths.get("app").resolve(path);
        return new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
    }

    @Test
    public void yedeklemeKapaliVeCleartextDerlemeTuruneBagli() throws Exception {
        String manifest = read("src/main/AndroidManifest.xml");
        assertTrue(manifest.contains("android:allowBackup=\"false\""));
        assertTrue(manifest.contains("android:usesCleartextTraffic=\"${usesCleartextTraffic}\""));
        assertTrue(manifest.contains("android:dataExtractionRules=\"@xml/data_extraction_rules\""));
    }

    @Test
    public void surumDerlemesindeCleartextKapali() throws Exception {
        String gradle = read("build.gradle");
        int release = gradle.indexOf("release {", gradle.indexOf("buildTypes"));
        int debug = gradle.indexOf("debug {", gradle.indexOf("buildTypes"));
        assertTrue(release > 0 && debug > 0);
        String releaseBlock = gradle.substring(release, gradle.indexOf("}", gradle.indexOf("manifestPlaceholders", release)) + 1);
        assertTrue(releaseBlock.contains("usesCleartextTraffic: 'false'"));
        assertFalse(releaseBlock.contains("usesCleartextTraffic: 'true'"));
    }

    @Test
    public void yalnizcaInternetIzniIstenir() throws Exception {
        String manifest = read("src/main/AndroidManifest.xml");
        int count = manifest.split("<uses-permission ", -1).length - 1;
        assertEquals(1, count);
        assertTrue(manifest.contains("android.permission.INTERNET"));
    }
}
