import Foundation
import Capacitor

/// Native Capacitor plugin for per-deck iCloud sync.
///
/// Provides file-level operations on the iCloud ubiquity container and
/// real-time change detection via NSMetadataQuery.
///
/// All paths are relative to the container's Documents directory:
///   Documents/Kit/{deckId}/snapshot.json
///   Documents/Kit/{deckId}/edits/{hlc}.json
///   Documents/Kit/{deckId}/source.apkg
@objc(ICloudSyncPlugin)
class ICloudSyncPlugin: CAPPlugin, CAPBridgedPlugin {

    let identifier = "ICloudSyncPlugin"
    let jsName = "ICloudSyncPlugin"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fileExists", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDownloadStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copyToICloud", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copyFromICloud", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startDownloading", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWatching", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopWatching", returnType: CAPPluginReturnPromise),
    ]

    private let syncRoot = "Kit"
    private var query: NSMetadataQuery?
    private var watchPath: String?

    // MARK: - Helpers

    /// Get the iCloud container Documents URL, creating it if needed.
    private func containerDocsURL() -> URL? {
        guard let container = FileManager.default.url(
            forUbiquityContainerIdentifier: nil
        ) else { return nil }
        let docs = container.appendingPathComponent("Documents")
            .appendingPathComponent(syncRoot)
        try? FileManager.default.createDirectory(
            at: docs, withIntermediateDirectories: true, attributes: nil
        )
        return docs
    }

    /// Resolve a relative path to a full iCloud URL.
    private func resolveURL(_ relativePath: String) -> URL? {
        guard let base = containerDocsURL() else { return nil }
        return base.appendingPathComponent(relativePath)
    }

    /// Ensure parent directories exist for a file URL.
    private func ensureParent(_ url: URL) {
        let parent = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(
            at: parent, withIntermediateDirectories: true, attributes: nil
        )
    }

    // MARK: - Availability

    @objc func checkAvailability(_ call: CAPPluginCall) {
        let available = FileManager.default.ubiquityIdentityToken != nil
        call.resolve(["available": available])
    }

    // MARK: - File Operations

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"),
              let data = call.getString("data") else {
            call.reject("Missing 'path' or 'data'")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = self.resolveURL(path) else {
                DispatchQueue.main.async { call.reject("iCloud not available") }
                return
            }

            self.ensureParent(url)

            do {
                try data.write(to: url, atomically: true, encoding: .utf8)
                DispatchQueue.main.async { call.resolve() }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Write failed: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing 'path'")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = self.resolveURL(path) else {
                DispatchQueue.main.async { call.resolve(["data": NSNull()]) }
                return
            }

            // Trigger download if evicted
            try? FileManager.default.startDownloadingUbiquitousItem(at: url)

            // Wait briefly for download
            var attempts = 0
            while !FileManager.default.isReadableFile(atPath: url.path) && attempts < 20 {
                Thread.sleep(forTimeInterval: 0.25)
                attempts += 1
            }

            guard FileManager.default.isReadableFile(atPath: url.path) else {
                DispatchQueue.main.async { call.resolve(["data": NSNull()]) }
                return
            }

            do {
                let content = try String(contentsOf: url, encoding: .utf8)
                DispatchQueue.main.async { call.resolve(["data": content]) }
            } catch {
                DispatchQueue.main.async { call.resolve(["data": NSNull()]) }
            }
        }
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing 'path'")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = self.resolveURL(path) else {
                DispatchQueue.main.async { call.resolve() }
                return
            }

            try? FileManager.default.removeItem(at: url)
            DispatchQueue.main.async { call.resolve() }
        }
    }

    @objc func listDirectory(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing 'path'")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = self.resolveURL(path) else {
                DispatchQueue.main.async { call.resolve(["files": []]) }
                return
            }

            do {
                let items = try FileManager.default.contentsOfDirectory(
                    at: url,
                    includingPropertiesForKeys: nil,
                    options: [.skipsHiddenFiles]
                )
                let names = items.map { $0.lastPathComponent }
                DispatchQueue.main.async { call.resolve(["files": names]) }
            } catch {
                DispatchQueue.main.async { call.resolve(["files": []]) }
            }
        }
    }

    @objc func fileExists(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing 'path'")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = self.resolveURL(path) else {
                DispatchQueue.main.async { call.resolve(["exists": false]) }
                return
            }

            let exists = FileManager.default.fileExists(atPath: url.path)
            DispatchQueue.main.async { call.resolve(["exists": exists]) }
        }
    }

    @objc func getDownloadStatus(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing 'path'")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = self.resolveURL(path) else {
                DispatchQueue.main.async {
                    call.resolve(["status": "unavailable"])
                }
                return
            }

            do {
                let values = try url.resourceValues(
                    forKeys: [.ubiquitousItemDownloadingStatusKey]
                )
                let status = values.ubiquitousItemDownloadingStatus
                let statusStr: String
                switch status {
                case .current:
                    statusStr = "downloaded"
                case .downloaded:
                    statusStr = "downloaded"
                case .notDownloaded:
                    statusStr = "not-downloaded"
                default:
                    statusStr = "unknown"
                }
                DispatchQueue.main.async {
                    call.resolve(["status": statusStr])
                }
            } catch {
                DispatchQueue.main.async {
                    call.resolve(["status": "unknown"])
                }
            }
        }
    }

    // MARK: - Large File Copy

    @objc func copyToICloud(_ call: CAPPluginCall) {
        guard let localPath = call.getString("localPath"),
              let remotePath = call.getString("remotePath") else {
            call.reject("Missing 'localPath' or 'remotePath'")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let destURL = self.resolveURL(remotePath) else {
                DispatchQueue.main.async { call.reject("iCloud not available") }
                return
            }

            let srcURL = URL(fileURLWithPath: localPath)
            self.ensureParent(destURL)

            do {
                // Remove existing file if present
                if FileManager.default.fileExists(atPath: destURL.path) {
                    try FileManager.default.removeItem(at: destURL)
                }
                try FileManager.default.copyItem(at: srcURL, to: destURL)
                DispatchQueue.main.async { call.resolve() }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Copy to iCloud failed: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc func copyFromICloud(_ call: CAPPluginCall) {
        guard let remotePath = call.getString("remotePath"),
              let localPath = call.getString("localPath") else {
            call.reject("Missing 'remotePath' or 'localPath'")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let srcURL = self.resolveURL(remotePath) else {
                DispatchQueue.main.async { call.reject("iCloud not available") }
                return
            }

            // Trigger download if evicted
            try? FileManager.default.startDownloadingUbiquitousItem(at: srcURL)

            // Wait for download (up to 30s for large files)
            var attempts = 0
            while !FileManager.default.isReadableFile(atPath: srcURL.path) && attempts < 60 {
                Thread.sleep(forTimeInterval: 0.5)
                attempts += 1
            }

            let destURL = URL(fileURLWithPath: localPath)

            do {
                // Ensure parent directory exists
                try FileManager.default.createDirectory(
                    at: destURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true,
                    attributes: nil
                )
                if FileManager.default.fileExists(atPath: destURL.path) {
                    try FileManager.default.removeItem(at: destURL)
                }
                try FileManager.default.copyItem(at: srcURL, to: destURL)
                DispatchQueue.main.async { call.resolve() }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Copy from iCloud failed: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc func startDownloading(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing 'path'")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = self.resolveURL(path) else {
                DispatchQueue.main.async { call.resolve() }
                return
            }

            try? FileManager.default.startDownloadingUbiquitousItem(at: url)
            DispatchQueue.main.async { call.resolve() }
        }
    }

    // MARK: - File Watching (NSMetadataQuery)

    @objc func startWatching(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing 'path'")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            // Stop any existing query
            self.query?.stop()

            guard let baseURL = self.containerDocsURL() else {
                call.resolve()
                return
            }

            self.watchPath = path
            let fullPath = baseURL.appendingPathComponent(path).path

            let mdQuery = NSMetadataQuery()
            mdQuery.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
            mdQuery.predicate = NSPredicate(
                format: "%K BEGINSWITH %@",
                NSMetadataItemPathKey,
                fullPath
            )

            NotificationCenter.default.addObserver(
                self,
                selector: #selector(self.metadataQueryDidUpdate(_:)),
                name: .NSMetadataQueryDidUpdate,
                object: mdQuery
            )

            NotificationCenter.default.addObserver(
                self,
                selector: #selector(self.metadataQueryDidFinishGathering(_:)),
                name: .NSMetadataQueryDidFinishGathering,
                object: mdQuery
            )

            self.query = mdQuery
            mdQuery.start()

            call.resolve()
        }
    }

    @objc func stopWatching(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.query?.stop()
            self?.query = nil
            self?.watchPath = nil

            NotificationCenter.default.removeObserver(
                self as Any,
                name: .NSMetadataQueryDidUpdate,
                object: nil
            )
            NotificationCenter.default.removeObserver(
                self as Any,
                name: .NSMetadataQueryDidFinishGathering,
                object: nil
            )

            call.resolve()
        }
    }

    @objc private func metadataQueryDidFinishGathering(_ notification: Notification) {
        query?.enableUpdates()
    }

    @objc private func metadataQueryDidUpdate(_ notification: Notification) {
        guard let query = notification.object as? NSMetadataQuery else { return }

        query.disableUpdates()
        defer { query.enableUpdates() }

        var changedFiles: [[String: Any]] = []

        // Check for added/updated items
        if let added = notification.userInfo?[NSMetadataQueryUpdateAddedItemsKey] as? [NSMetadataItem] {
            for item in added {
                if let path = item.value(forAttribute: NSMetadataItemPathKey) as? String {
                    changedFiles.append(["path": path, "event": "added"])
                }
            }
        }

        if let changed = notification.userInfo?[NSMetadataQueryUpdateChangedItemsKey] as? [NSMetadataItem] {
            for item in changed {
                if let path = item.value(forAttribute: NSMetadataItemPathKey) as? String {
                    changedFiles.append(["path": path, "event": "changed"])
                }
            }
        }

        if let removed = notification.userInfo?[NSMetadataQueryUpdateRemovedItemsKey] as? [NSMetadataItem] {
            for item in removed {
                if let path = item.value(forAttribute: NSMetadataItemPathKey) as? String {
                    changedFiles.append(["path": path, "event": "removed"])
                }
            }
        }

        if !changedFiles.isEmpty {
            notifyListeners("icloudFilesChanged", data: [
                "files": changedFiles
            ])
        }
    }
}
