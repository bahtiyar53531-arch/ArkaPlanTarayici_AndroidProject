package org.arkaplan.ototiklayici.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.arkaplan.ototiklayici.R
import org.arkaplan.ototiklayici.util.SystemSettings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpScreen(vm: MainViewModel) {
    val context = LocalContext.current
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Nasıl kullanılır?") },
                navigationIcon = { IconButton(onClick = { vm.back() }) { AppIcon(R.drawable.ic_back, "Geri") } },
            )
        },
    ) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = padding.calculateTopPadding() + 8.dp, bottom = padding.calculateBottomPadding() + 32.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                SectionCard("1 · Servisi aç") {
                    Para("Ayarlar › Erişilebilirlik › Yüklü uygulamalar › Oto Tıklayıcı › Aç. Dokunuşları sisteme bu servis uygular; ekran içeriğini okumaz.")
                    Para("“Kısıtlanmış ayar” uyarısı mı çıktı? (Android 13+, mağaza dışından yüklenen uygulamalarda) Uygulama bilgisi › sağ üstteki ⋮ › “Kısıtlanmış ayarlara izin ver”i seç, sonra servisi yeniden aç.")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = { SystemSettings.openAccessibilitySettings(context) }) { Text("Erişilebilirlik") }
                        FilledTonalButton(onClick = { SystemSettings.openAppInfo(context) }) { Text("Uygulama bilgisi") }
                    }
                }
            }
            item {
                SectionCard("2 · Mod seç") {
                    Bullet(R.drawable.ic_touch, "Tek nokta", "Ekrana tek bir hedef koyar. Hedefi sürükle, ▶ ile başlat. Hedefe dokunarak aralık, basma süresi ve çift/üçlü tık ayarlanır.")
                    Bullet(R.drawable.ic_targets, "Çoklu nokta", "＋ ile sıralı dokunma, ↔ ile kaydırma hedefleri ekle. Numaralar oynatma sırasıdır. Kaydırmanın yeşil ucu başlangıç, turuncu ucu bitiştir.")
                    Bullet(R.drawable.ic_gesture, "Kaydet & tekrarla", "● ile kaydı başlat ve uygulamayı normal kullan: dokunma, uzun basma, kaydırma, sürükleme ve iki parmak hareketleri zamanlamasıyla kaydedilir. ● tekrar basınca kayıt biter, ▶ aynen tekrarlar.")
                }
            }
            item {
                SectionCard("Panel düğmeleri") {
                    Legend(R.drawable.ic_drag, "Sürükleyerek paneli taşı, dokunarak küçült/büyüt")
                    Legend(R.drawable.ic_play, "Başlat / durdur")
                    Legend(R.drawable.ic_record, "Hareketlerini kaydet")
                    Legend(R.drawable.ic_add, "Dokunma hedefi ekle")
                    Legend(R.drawable.ic_swipe, "Kaydırma hedefi ekle")
                    Legend(R.drawable.ic_undo, "Son adımı sil (uzun bas: hepsini sil)")
                    Legend(R.drawable.ic_visibility, "Hedefleri göster / gizle")
                    Legend(R.drawable.ic_tune, "Tekrar sayısı, süre, hız, rastgelelik, tüm beklemeler")
                    Legend(R.drawable.ic_save, "Kaydet (uzun bas: farklı kaydet)")
                    Legend(R.drawable.ic_close, "Paneli kapat")
                }
            }
            item {
                SectionCard("Durdurmanın yolları") {
                    Para("• Paneldeki ■ düğmesi\n• Ses açma/kısma tuşu (ayarlardan)\n• Ekranı kapatmak (ayarlardan)\n• Başka uygulamaya geçmek (ayarlardan)\n• Bildirim panelindeki “Oto Tıklayıcı” kutucuğu paneli kapatır")
                }
            }
            item {
                SectionCard("İpuçları") {
                    Para("• Hedef panelin altında kalırsa dokunuş panele gider; paneli kenara taşı.\n• Oynatma sırasında ekrana dokunursan o anki hareket iptal olur, oynatma devam eder.\n• Kayıtta dokunuş parmağın kalkınca uygulamaya iletilir; çok hızlı ardışık dokunuşlarda bir tanesi kaçarsa biraz daha yavaş yap ya da aktarımı kapatıp yalnızca kaydet.\n• Rastgele gecikme ve konum sapması, dokunuşları insan gibi gösterir.\n• Hız %200 iki kat hızlı, %50 yarı hızda oynatır.\n• Hızlı ayar kutucuğunu bildirim paneline ekleyerek paneli tek dokunuşla açabilirsin.")
                }
            }
            item {
                SectionCard("Servis kendi kendine kapanıyorsa") {
                    Para("Xiaomi, Huawei, Oppo, Vivo ve Samsung gibi telefonlar pil tasarrufu için servisleri kapatabilir. Pil optimizasyonunu kapat; varsa “Otomatik başlatma”ya izin ver ve uygulamayı son uygulamalar ekranında kilitle.")
                    FilledTonalButton(onClick = { SystemSettings.requestIgnoreBatteryOptimizations(context) }) { Text("Pil optimizasyonunu kapat") }
                }
            }
            item {
                SectionCard("Gizlilik") {
                    Para("Uygulamanın internet izni yoktur. Ekran içeriğini okumaz, yazdıklarını kaydetmez. Makrolar yalnızca bu cihazda (ve senin dışa aktardığın dosyalarda) saklanır.")
                }
            }
        }
    }
}

@Composable
private fun Para(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun Bullet(icon: Int, title: String, text: String) {
    Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(vertical = 4.dp)) {
        AppIcon(icon, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Legend(icon: Int, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        AppIcon(icon, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}
