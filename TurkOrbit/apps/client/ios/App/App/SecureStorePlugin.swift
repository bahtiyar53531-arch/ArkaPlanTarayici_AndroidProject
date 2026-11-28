import Foundation
import Capacitor
import Security

/// Oturum anahtarı gibi küçük gizli değerler için iOS Keychain deposu (Aşama 15).
/// JavaScript tarafı: apps/client/src/platform/secure-store.ts (registerPlugin('TurkOrbitSecureStore')).
///
/// - Öğeler kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly ile yazılır: iCloud/iTunes yedeğine ve başka cihaza taşınmaz.
/// - Keychain öğeleri uygulama silinse de cihazda kalabilir; uygulama yeniden kurulunca ilk açılışta temizlenir
///   (yeniden kurulan uygulama eski oturumla kendiliğinden açılmaz).
/// - Değerler hiçbir zaman günlüğe yazılmaz.
@objc(SecureStorePlugin)
public class SecureStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureStorePlugin"
    public let jsName = "TurkOrbitSecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private static let maxValueLength = 4096
    private static let installedFlag = "turkorbit.securestore.installed"
    private let service = (Bundle.main.bundleIdentifier ?? "com.turkorbit.oyun") + ".securestore"

    override public func load() {
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: SecureStorePlugin.installedFlag) {
            // İlk açılış (veya yeniden kurulum): önceki kurulumdan kalan Keychain öğeleri silinir
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
            SecItemDelete(query as CFDictionary)
            defaults.set(true, forKey: SecureStorePlugin.installedFlag)
        }
    }

    private func validKey(_ call: CAPPluginCall) -> String? {
        guard let key = call.getString("key"), key.range(of: "^[A-Za-z0-9_.-]{1,64}$", options: .regularExpression) != nil else {
            call.reject("Geçersiz anahtar adı.", "INVALID_KEY")
            return nil
        }
        return key
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = validKey(call) else { return }
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else {
            // Bulunamayan veya okunamayan değer "yok" sayılır; oyuncu yeniden giriş yapar
            call.resolve(["value": NSNull()])
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = validKey(call) else { return }
        guard let value = call.getString("value"), !value.isEmpty, value.count <= SecureStorePlugin.maxValueLength,
              let data = value.data(using: .utf8) else {
            call.reject("Geçersiz değer.", "INVALID_VALUE")
            return
        }
        SecItemDelete(baseQuery(key) as CFDictionary)
        var query = baseQuery(key)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Güvenli depoya yazılamadı.", "WRITE_FAILED")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = validKey(call) else { return }
        SecItemDelete(baseQuery(key) as CFDictionary)
        call.resolve()
    }
}
