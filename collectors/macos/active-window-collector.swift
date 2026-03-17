import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

private let collectorId = "macos-active-window"
private let permissionSettingsPath = "System Settings > Privacy & Security > Accessibility"

private struct Options {
    var outputPath: String?
    var ingestURL: URL?
    var ingestAuthToken: String?
    var pollIntervalMs = 1000
    var once = false
    var checkPermissions = false
    var promptAccessibility = false
    var stdout = false
    var json = false
}

private enum CollectorError: Error, CustomStringConvertible {
    case invalidArgument(String)
    case missingValue(String)
    case invalidNumber(String)
    case invalidURL(String)
    case noFrontmostApplication
    case postFailed(Int)

    var description: String {
        switch self {
        case let .invalidArgument(argument):
            return "Unknown argument: \(argument)"
        case let .missingValue(argument):
            return "Missing value for argument: \(argument)"
        case let .invalidNumber(value):
            return "Invalid number: \(value)"
        case let .invalidURL(value):
            return "Invalid URL: \(value)"
        case .noFrontmostApplication:
            return "Unable to determine the current frontmost application."
        case let .postFailed(statusCode):
            return "Collector POST request failed with HTTP \(statusCode)."
        }
    }
}

private struct Snapshot {
    let application: String
    let windowTitle: String?
    let bundleId: String?
    let processId: pid_t
    let accessibilityTrusted: Bool
    let timestamp: String

    var fingerprint: String {
        [application, bundleId ?? "", windowTitle ?? "", String(processId)].joined(separator: "|")
    }

    var eventPayload: [String: Any] {
        var metadata: [String: Any] = [
            "collector": collectorId,
            "platform": "macos",
            "processId": Int(processId),
            "accessibilityTrusted": accessibilityTrusted,
        ]

        if let bundleId {
            metadata["bundleId"] = bundleId
        }

        var payload: [String: Any] = [
            "source": "desktop",
            "sourceEventType": "app.switch",
            "timestamp": timestamp,
            "application": application,
            "action": "switch",
            "metadata": metadata,
        ]

        if let windowTitle {
            payload["windowTitle"] = windowTitle
        }

        return payload
    }
}

private struct FrontmostApplicationContext {
    let localizedName: String?
    let bundleIdentifier: String?
    let processId: pid_t
}

private let bundleIdApplicationMap = [
    "com.google.Chrome": "chrome",
    "com.apple.Safari": "safari",
    "company.thebrowser.Browser": "arc",
    "com.brave.Browser": "brave",
    "org.mozilla.firefox": "firefox",
    "com.microsoft.Outlook": "outlook",
    "com.microsoft.Excel": "excel",
    "com.microsoft.Word": "word",
    "com.microsoft.Powerpoint": "powerpoint",
    "com.apple.finder": "finder",
    "com.apple.Terminal": "terminal",
    "com.googlecode.iterm2": "iterm",
    "com.tinyspeck.slackmacgap": "slack",
    "com.todesktop.230313mzl4w4u92": "cursor",
    "com.microsoft.VSCode": "vscode",
    "md.obsidian": "obsidian",
    "notion.id": "notion",
]

private let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private func printUsage() {
    let usage = """
    Usage:
      swift collectors/macos/active-window-collector.swift [options]

    Options:
      --output-path <path>         Append NDJSON events to a file.
      --ingest-url <url>           POST events to the local ingest server.
      --ingest-auth-token <token>  Send the shared ingest auth token.
      --poll-interval-ms <ms>      Poll interval in milliseconds. Default: 1000.
      --once                       Capture one snapshot and exit.
      --stdout                     Print NDJSON events to stdout.
      --check-permissions          Print Accessibility permission status and exit.
      --prompt-accessibility       Ask macOS to show the Accessibility permission prompt.
      --json                       Print JSON output for permission checks.
      --help                       Show this message.

    Notes:
      - Frontmost application capture works without Accessibility access.
      - Focused window titles usually require Accessibility access.
      - Permission path: \(permissionSettingsPath)
    """

    print(usage)
}

private func parseArguments() throws -> Options {
    var options = Options()
    let args = Array(CommandLine.arguments.dropFirst())
    var index = 0

    while index < args.count {
        let argument = args[index]

        switch argument {
        case "--output-path":
            index += 1
            guard index < args.count else {
                throw CollectorError.missingValue(argument)
            }
            options.outputPath = args[index]
        case "--ingest-url":
            index += 1
            guard index < args.count else {
                throw CollectorError.missingValue(argument)
            }
            guard let url = URL(string: args[index]) else {
                throw CollectorError.invalidURL(args[index])
            }
            options.ingestURL = url
        case "--ingest-auth-token":
            index += 1
            guard index < args.count else {
                throw CollectorError.missingValue(argument)
            }
            options.ingestAuthToken = args[index]
        case "--poll-interval-ms":
            index += 1
            guard index < args.count else {
                throw CollectorError.missingValue(argument)
            }
            guard let value = Int(args[index]), value > 0 else {
                throw CollectorError.invalidNumber(args[index])
            }
            options.pollIntervalMs = value
        case "--once":
            options.once = true
        case "--stdout":
            options.stdout = true
        case "--check-permissions":
            options.checkPermissions = true
        case "--prompt-accessibility":
            options.promptAccessibility = true
        case "--json":
            options.json = true
        case "--help", "-h":
            printUsage()
            Foundation.exit(EXIT_SUCCESS)
        default:
            throw CollectorError.invalidArgument(argument)
        }

        index += 1
    }

    if !options.stdout && options.outputPath == nil && options.ingestURL == nil && !options.checkPermissions {
        options.outputPath = "./macos-active-window-events.ndjson"
    }

    return options
}

private func printError(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

private func accessibilityTrusted(prompt: Bool) -> Bool {
    guard prompt else {
        return AXIsProcessTrusted()
    }

    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

private func canonicalApplicationName(localizedName: String?, bundleIdentifier: String?) -> String {
    if let bundleIdentifier, let mapped = bundleIdApplicationMap[bundleIdentifier] {
        return mapped
    }

    let fallback = localizedName?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        ?? bundleIdentifier?.split(separator: ".").last.map(String.init)?.lowercased()
        ?? "unknown"
    let tokens = fallback
        .components(separatedBy: CharacterSet.alphanumerics.inverted)
        .filter { !$0.isEmpty }

    return tokens.isEmpty ? "unknown" : tokens.joined(separator: "-")
}

private func focusedWindowTitle(processId: pid_t) -> String? {
    let applicationElement = AXUIElementCreateApplication(processId)
    var focusedWindowValue: CFTypeRef?
    let focusedWindowResult = AXUIElementCopyAttributeValue(
        applicationElement,
        kAXFocusedWindowAttribute as CFString,
        &focusedWindowValue
    )

    guard focusedWindowResult == .success, let focusedWindowValue else {
        return nil
    }

    let focusedWindow = unsafeBitCast(focusedWindowValue, to: AXUIElement.self)
    var titleValue: CFTypeRef?
    let titleResult = AXUIElementCopyAttributeValue(focusedWindow, kAXTitleAttribute as CFString, &titleValue)

    guard titleResult == .success, let title = titleValue as? String else {
        return nil
    }

    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func frontmostApplicationContext() -> FrontmostApplicationContext? {
    // NSWorkspace.shared.frontmostApplication can stay stale in a long-running CLI process.
    guard let windowInfoList = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else {
        return nil
    }

    for windowInfo in windowInfoList {
        let layer = windowInfo[kCGWindowLayer as String] as? Int ?? -1
        guard layer == 0 else {
            continue
        }

        guard let pidNumber = windowInfo[kCGWindowOwnerPID as String] as? NSNumber else {
            continue
        }

        let processId = pid_t(pidNumber.int32Value)
        guard processId > 0 else {
            continue
        }

        let runningApplication = NSRunningApplication(processIdentifier: processId)

        return FrontmostApplicationContext(
            localizedName: runningApplication?.localizedName ?? (windowInfo[kCGWindowOwnerName as String] as? String),
            bundleIdentifier: runningApplication?.bundleIdentifier,
            processId: processId
        )
    }

    return nil
}

private func captureSnapshot(promptAccessibility: Bool) throws -> Snapshot {
    let trusted = accessibilityTrusted(prompt: promptAccessibility)

    guard let application = frontmostApplicationContext() else {
        throw CollectorError.noFrontmostApplication
    }

    let canonicalApplication = canonicalApplicationName(
        localizedName: application.localizedName,
        bundleIdentifier: application.bundleIdentifier
    )
    let windowTitle = trusted ? focusedWindowTitle(processId: application.processId) : nil

    return Snapshot(
        application: canonicalApplication,
        windowTitle: windowTitle,
        bundleId: application.bundleIdentifier,
        processId: application.processId,
        accessibilityTrusted: trusted,
        timestamp: isoFormatter.string(from: Date())
    )
}

private func jsonString(for object: Any, prettyPrinted: Bool) throws -> String {
    let options: JSONSerialization.WritingOptions = prettyPrinted ? [.prettyPrinted, .sortedKeys] : [.sortedKeys]
    let data = try JSONSerialization.data(withJSONObject: object, options: options)
    return String(decoding: data, as: UTF8.self)
}

private func appendLine(_ line: String, to path: String) throws {
    let fileManager = FileManager.default
    let url = URL(fileURLWithPath: path)
    let directoryURL = url.deletingLastPathComponent()

    try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)

    let data = Data((line + "\n").utf8)
    if !fileManager.fileExists(atPath: url.path) {
        fileManager.createFile(atPath: url.path, contents: data)
        return
    }

    let handle = try FileHandle(forWritingTo: url)
    defer {
        try? handle.close()
    }
    try handle.seekToEnd()
    try handle.write(contentsOf: data)
}

private func postEvent(_ eventPayload: [String: Any], to ingestURL: URL, authToken: String?) throws {
    var request = URLRequest(url: ingestURL)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let authToken, !authToken.isEmpty {
        request.setValue(authToken, forHTTPHeaderField: "X-What-Ive-Done-Token")
    }
    request.httpBody = try JSONSerialization.data(withJSONObject: ["events": [eventPayload]], options: [])

    let semaphore = DispatchSemaphore(value: 0)
    var responseError: Error?
    var statusCode = 0

    let task = URLSession.shared.dataTask(with: request) { _, response, error in
        responseError = error
        statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        semaphore.signal()
    }

    task.resume()
    semaphore.wait()

    if let responseError {
        throw responseError
    }

    guard (200..<300).contains(statusCode) else {
        throw CollectorError.postFailed(statusCode)
    }
}

private func publishSnapshot(_ snapshot: Snapshot, options: Options) throws {
    let line = try jsonString(for: snapshot.eventPayload, prettyPrinted: false)

    if options.stdout {
        print(line)
    }

    if let outputPath = options.outputPath {
        try appendLine(line, to: outputPath)
    }

    if let ingestURL = options.ingestURL {
        try postEvent(snapshot.eventPayload, to: ingestURL, authToken: options.ingestAuthToken)
    }
}

private func printPermissionStatus(options: Options) throws {
    let trusted = accessibilityTrusted(prompt: options.promptAccessibility)
    let payload: [String: Any] = [
        "collector": collectorId,
        "platform": "macos",
        "accessibilityTrusted": trusted,
        "windowTitleAvailable": trusted,
        "frontmostApplicationAvailable": true,
        "systemSettingsPath": permissionSettingsPath,
    ]

    if options.json {
        print(try jsonString(for: payload, prettyPrinted: true))
        return
    }

    print("Accessibility trusted: \(trusted ? "yes" : "no")")
    print("Frontmost application capture: available")
    print("Focused window title capture: \(trusted ? "available" : "limited until permission is granted")")
    print("Permission path: \(permissionSettingsPath)")
}

private func runCollector(options: Options) throws {
    let initialTrusted = accessibilityTrusted(prompt: options.promptAccessibility)

    printError("What I've Done macOS collector started.")
    printError("Poll interval: \(options.pollIntervalMs) ms")
    if let outputPath = options.outputPath {
        printError("NDJSON output: \(outputPath)")
    }
    if let ingestURL = options.ingestURL {
        printError("Ingest URL: \(ingestURL.absoluteString)")
        if options.ingestAuthToken != nil {
            printError("Ingest auth token: configured")
        }
    }
    if options.stdout {
        printError("Stdout output: enabled")
    }
    if initialTrusted {
        printError("Accessibility permission: granted")
    } else {
        printError("Accessibility permission: not granted. App switches will still be captured, but focused window titles may be unavailable.")
        printError("Grant access at: \(permissionSettingsPath)")
    }

    var lastFingerprint: String?

    while true {
        do {
            let snapshot = try captureSnapshot(promptAccessibility: false)
            if options.once || snapshot.fingerprint != lastFingerprint {
                try publishSnapshot(snapshot, options: options)
                lastFingerprint = snapshot.fingerprint
            }
        } catch {
            if options.once {
                throw error
            }

            printError("Warning: \(error)")
        }

        if options.once {
            return
        }

        Thread.sleep(forTimeInterval: Double(options.pollIntervalMs) / 1000.0)
    }
}

do {
    let options = try parseArguments()

    if options.checkPermissions {
        try printPermissionStatus(options: options)
        Foundation.exit(EXIT_SUCCESS)
    }

    try runCollector(options: options)
} catch {
    if let collectorError = error as? CollectorError {
        printError(collectorError.description)
    } else {
        printError(String(describing: error))
    }

    printError("")
    printUsage()
    Foundation.exit(EXIT_FAILURE)
}
