plugins {
    alias(libs.plugins.kotlin.jvm)
}

// Bu modul Android'e bagimli DEGILDIR. Oyun adresi, alan adi guvenligi,
// yukleme ilerlemesi, FPS/ping istatistigi, zoom ve yeniden baglanma
// mantigi burada durur. Ileride iOS surumu icin Kotlin Multiplatform'a
// dogrudan tasinabilir.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation(libs.junit)
}
