import Foundation
import Capacitor

/// Native Capacitor plugin for iCloud Drive backup/sync.
///
/// Uses NSFileManager ubiquity container to store:
///   - kit_backup.db   — the SQLite database snapshot (base64-encoded)
///   - backup_meta.json — metadata (timestamp, card count, device name)
///
/// The ubiquity container identifier is nil (uses the app's default container
/// as configured in the entitlements file).
@objc(ICloudPlugin)
class ICloudPlugin: CAPPlugin, CAPBridgedPlugin {

    let identifier = "ICloudPlugin"
    let jsName = "ICloudPlugin"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadMeta", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkAvailability", returnType: CAPPluginReturnPromise),
    ]

    private let dbFilename = "kit_backup.db"
    private let metaFilename = "backup_meta.json"

    // MARK: - Plugin Methods

    /// Check if iCloud is available on this device.
    @objc func checkAvailability(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            // ubiquityIdentityToken is nil if user is not signed into iCloud.
            // url(forUbiquityContainerIdentifier:) must be called off main thread
            // and returns nil if the container isn't registered in the Dev portal
            // or the entitlements aren't code-signed into the build.
            let available = FileManager.default.ubiquityIdentityToken != nil
                && FileManager.default.url(forUbiquityContainerIdentifier: "iCloud.com.kai.kit") != nil
            call.resolve(["available": available])
        }
    }

    /// Save the database and metadata to iCloud Drive.
    @objc func saveBackup(_ call: CAPPluginCall) {
        guard let data = call.getString("data") else {
            call.reject("Missing 'data' parameter")
            return
        }
        guard let meta = call.getString("meta") else {
            call.reject("Missing 'meta' parameter")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            guard let containerURL = FileManager.default.url(
                forUbiquityContainerIdentifier: "iCloud.com.kai.kit"
            ) else {
                call.reject("iCloud container not available")
                return
            }

            let documentsURL = containerURL.appendingPathComponent("Documents")

            // Create Documents directory if it doesn't exist
            do {
                try FileManager.default.createDirectory(
                    at: documentsURL,
                    withIntermediateDirectories: true,
                    attributes: nil
                )
            } catch {
                call.reject("Failed to create iCloud Documents directory: \(error.localizedDescription)")
                return
            }

            let dbURL = documentsURL.appendingPathComponent(self.dbFilename)
            let metaURL = documentsURL.appendingPathComponent(self.metaFilename)

            do {
                // Write database backup (base64 string)
                try data.write(to: dbURL, atomically: true, encoding: .utf8)

                // Write metadata JSON
                try meta.write(to: metaURL, atomically: true, encoding: .utf8)

                DispatchQueue.main.async {
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Failed to write iCloud backup: \(error.localizedDescription)")
                }
            }
        }
    }

    /// Load the database backup from iCloud Drive.
    @objc func loadBackup(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            guard let containerURL = FileManager.default.url(
                forUbiquityContainerIdentifier: "iCloud.com.kai.kit"
            ) else {
                DispatchQueue.main.async { call.resolve([:]) }
                return
            }

            let dbURL = containerURL
                .appendingPathComponent("Documents")
                .appendingPathComponent(self.dbFilename)

            guard FileManager.default.fileExists(atPath: dbURL.path) else {
                DispatchQueue.main.async { call.resolve([:]) }
                return
            }

            do {
                // Trigger download if the file is in iCloud but not local
                try FileManager.default.startDownloadingUbiquitousItem(at: dbURL)

                // Wait briefly for the file to become available
                var attempts = 0
                while !FileManager.default.isReadableFile(atPath: dbURL.path) && attempts < 30 {
                    Thread.sleep(forTimeInterval: 0.5)
                    attempts += 1
                }

                let data = try String(contentsOf: dbURL, encoding: .utf8)
                DispatchQueue.main.async {
                    call.resolve(["data": data])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Failed to read iCloud backup: \(error.localizedDescription)")
                }
            }
        }
    }

    /// Load backup metadata from iCloud Drive.
    @objc func loadMeta(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            guard let containerURL = FileManager.default.url(
                forUbiquityContainerIdentifier: "iCloud.com.kai.kit"
            ) else {
                DispatchQueue.main.async { call.resolve([:]) }
                return
            }

            let metaURL = containerURL
                .appendingPathComponent("Documents")
                .appendingPathComponent(self.metaFilename)

            guard FileManager.default.fileExists(atPath: metaURL.path) else {
                DispatchQueue.main.async { call.resolve([:]) }
                return
            }

            do {
                try FileManager.default.startDownloadingUbiquitousItem(at: metaURL)

                var attempts = 0
                while !FileManager.default.isReadableFile(atPath: metaURL.path) && attempts < 10 {
                    Thread.sleep(forTimeInterval: 0.3)
                    attempts += 1
                }

                let meta = try String(contentsOf: metaURL, encoding: .utf8)
                DispatchQueue.main.async {
                    call.resolve(["meta": meta])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Failed to read iCloud metadata: \(error.localizedDescription)")
                }
            }
        }
    }
}
