import UIKit
import Capacitor

/// Uygulamanın kendi yerel eklentilerini köprüye kaydeder (Aşama 15).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SecureStorePlugin())
    }
}
