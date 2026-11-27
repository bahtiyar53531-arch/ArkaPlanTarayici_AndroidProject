pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "OrbitraGame"

// :core  -> Platformdan bagimsiz saf Kotlin is mantigi (iOS'a tasinabilir).
// :app   -> Android uygulamasi (WebView, PiP, servis, arayuz).
include(":core")
include(":app")
