import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Release imzalama bilgileri: once OrbitraGame/keystore.properties dosyasi,
// yoksa ortam degiskenleri (GitHub Actions secrets) okunur.
// Anahtar deposu (keystore) ASLA git'e eklenmez.
val signingProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(key: String, env: String): String? =
    signingProps.getProperty(key) ?: System.getenv(env)

val releaseStoreFile = signingValue("storeFile", "ORBITRA_KEYSTORE_FILE")
val hasReleaseSigning = releaseStoreFile != null && rootProject.file(releaseStoreFile).exists()

android {
    namespace = "space.orbitragame.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "space.orbitragame.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 2
        versionName = "1.1.0"
        vectorDrawables.useSupportLibrary = true
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile!!)
                storePassword = signingValue("storePassword", "ORBITRA_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "ORBITRA_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "ORBITRA_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            resValue("string", "app_name", "ORBITRAGAME.SPACE (Debug)")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            resValue("string", "app_name", "ORBITRAGAME.SPACE")
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("META-INF/*.version", "META-INF/LICENSE*", "kotlin/**", "DebugProbesKt.bin")
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all { it.maxHeapSize = "2g" }
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = true
        warningsAsErrors = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

base {
    archivesName.set("ORBITRAGAME.SPACE-v${android.defaultConfig.versionName}")
}

dependencies {
    implementation(project(":core"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.lifecycle.process)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}
