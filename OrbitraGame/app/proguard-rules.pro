# ORBITRAGAME.SPACE R8 kurallari
# WebMessageListener / WebView geri cagrilari androidx.webkit tarafindan tutulur.
-keepattributes *Annotation*
-keep class space.orbitragame.app.web.** { *; }
# Hata raporlarinda satir numaralari okunabilsin
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
