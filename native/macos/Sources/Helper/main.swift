import AppKit
import ApplicationServices
import CoreGraphics
import CryptoKit
import Darwin
import Foundation
import ScreenCaptureKit

private let helperVersion = "0.1.0"

private struct HelperError: Error {
    let code: String
    let message: String
}

private struct ElementRecord {
    let index: Int
    let locator: [Int]
    let element: AXUIElement
    let json: [String: Any]
    let hashLine: String
}

private struct ObservationSnapshot {
    let app: NSRunningApplication
    let appJSON: [String: Any]
    let frontmost: Bool
    let window: AXUIElement?
    let windowJSON: [String: Any]?
    let stateHash: String
    let treeText: String
    let truncated: Bool
    let elements: [ElementRecord]
}

private func fail(_ code: String, _ message: String) -> HelperError {
    HelperError(code: code, message: message)
}

private func string(_ object: Any?, _ field: String) throws -> String {
    guard let value = object as? String, !value.isEmpty else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "missing or invalid \(field)")
    }
    return value
}

private func stringAllowingEmpty(_ object: Any?, _ field: String) throws -> String {
    guard let value = object as? String else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "missing or invalid \(field)")
    }
    return value
}

private func int(_ object: Any?, _ field: String) throws -> Int {
    guard let number = object as? NSNumber else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "missing or invalid \(field)")
    }
    return number.intValue
}

private func double(_ object: Any?, _ field: String) throws -> Double {
    guard let number = object as? NSNumber else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "missing or invalid \(field)")
    }
    return number.doubleValue
}

private func bool(_ object: Any?, default fallback: Bool = false) -> Bool {
    (object as? NSNumber)?.boolValue ?? fallback
}

private func dictionary(_ object: Any?, _ field: String) throws -> [String: Any] {
    guard let value = object as? [String: Any] else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "missing or invalid \(field)")
    }
    return value
}

private func dictionaries(_ object: Any?) -> [[String: Any]] {
    object as? [[String: Any]] ?? []
}

private func permissionAccessibility() -> String {
    AXIsProcessTrusted() ? "granted" : "denied"
}

private func permissionScreenRecording() -> String {
    CGPreflightScreenCaptureAccess() ? "granted" : "denied"
}

private func runningApps() -> [NSRunningApplication] {
    NSWorkspace.shared.runningApplications
        .filter { !$0.isTerminated && $0.activationPolicy == .regular && $0.bundleIdentifier != nil }
        .sorted {
            let lhs = $0.localizedName ?? $0.bundleIdentifier ?? ""
            let rhs = $1.localizedName ?? $1.bundleIdentifier ?? ""
            return lhs.localizedCaseInsensitiveCompare(rhs) == .orderedAscending
        }
}

private func appJSON(_ app: NSRunningApplication) throws -> [String: Any] {
    guard let bundleId = app.bundleIdentifier else {
        throw fail("COMPUTER_APP_NOT_FOUND", "running application has no bundle identifier")
    }
    return [
        "bundleId": bundleId,
        "pid": Int(app.processIdentifier),
        "name": app.localizedName ?? bundleId,
    ]
}

private func resolveApp(_ selector: [String: Any]) throws -> NSRunningApplication {
    let bundleId = selector["bundleId"] as? String
    let pid = (selector["pid"] as? NSNumber)?.int32Value
    let name = selector["name"] as? String
    if bundleId == nil && pid == nil && name == nil {
        throw fail("COMPUTER_APP_NOT_FOUND", "app selector needs bundleId, pid, or unique name")
    }
    let matches = runningApps().filter { app in
        if let bundleId, app.bundleIdentifier != bundleId { return false }
        if let pid, app.processIdentifier != pid { return false }
        if let name {
            let display = app.localizedName ?? ""
            if display.compare(name, options: [.caseInsensitive, .diacriticInsensitive]) != .orderedSame { return false }
        }
        return true
    }
    guard matches.count == 1, let app = matches.first else {
        if matches.isEmpty { throw fail("COMPUTER_APP_NOT_FOUND", "no running application uniquely matches the selector") }
        if bundleId != nil {
            throw fail("COMPUTER_APP_NOT_FOUND", "multiple running processes match the bundleId; add the exact pid from computer_list_apps")
        }
        throw fail("COMPUTER_APP_NOT_FOUND", "application name is ambiguous; use bundleId and, if necessary, pid")
    }
    return app
}

private func axCopy(_ element: AXUIElement, _ attribute: CFString) -> Any? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute, &value)
    return result == .success ? value : nil
}

private func axString(_ element: AXUIElement, _ attribute: CFString) -> String? {
    if let value = axCopy(element, attribute) as? String, !value.isEmpty { return value }
    if let value = axCopy(element, attribute) as? NSAttributedString, !value.string.isEmpty { return value.string }
    return nil
}

private func axBool(_ element: AXUIElement, _ attribute: CFString) -> Bool? {
    (axCopy(element, attribute) as? NSNumber)?.boolValue
}

private func axPoint(_ element: AXUIElement, _ attribute: CFString) -> CGPoint? {
    guard let value = axCopy(element, attribute), CFGetTypeID(value as CFTypeRef) == AXValueGetTypeID() else { return nil }
    let axValue = value as! AXValue
    guard AXValueGetType(axValue) == .cgPoint else { return nil }
    var point = CGPoint.zero
    return AXValueGetValue(axValue, .cgPoint, &point) ? point : nil
}

private func axSize(_ element: AXUIElement, _ attribute: CFString) -> CGSize? {
    guard let value = axCopy(element, attribute), CFGetTypeID(value as CFTypeRef) == AXValueGetTypeID() else { return nil }
    let axValue = value as! AXValue
    guard AXValueGetType(axValue) == .cgSize else { return nil }
    var size = CGSize.zero
    return AXValueGetValue(axValue, .cgSize, &size) ? size : nil
}

private func axFrame(_ element: AXUIElement) -> CGRect? {
    guard let position = axPoint(element, kAXPositionAttribute as CFString),
          let size = axSize(element, kAXSizeAttribute as CFString),
          size.width >= 0, size.height >= 0 else { return nil }
    return CGRect(origin: position, size: size)
}

private func rectJSON(_ rect: CGRect) -> [String: Any] {
    ["x": rect.origin.x, "y": rect.origin.y, "width": rect.size.width, "height": rect.size.height]
}

private func axActions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success, let names else { return [] }
    return (names as NSArray).compactMap { $0 as? String }.sorted()
}

private func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    guard let values = axCopy(element, kAXChildrenAttribute as CFString) as? [AnyObject] else { return [] }
    return values.compactMap { value in
        guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }
}

private func sanitize(_ value: String, max: Int = 240) -> String {
    let collapsed = value.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
    guard collapsed.count > max else { return collapsed }
    return String(collapsed.prefix(max)) + "..."
}

private func jsonString(_ value: String) -> String {
    let data = try? JSONSerialization.data(withJSONObject: [value])
    let encoded = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
    return String(encoded.dropFirst().dropLast())
}

private func chosenWindow(_ appElement: AXUIElement) -> AXUIElement? {
    if let focused = axCopy(appElement, kAXFocusedWindowAttribute as CFString) as AnyObject?,
       CFGetTypeID(focused) == AXUIElementGetTypeID() {
        return (focused as! AXUIElement)
    }
    if let main = axCopy(appElement, kAXMainWindowAttribute as CFString) as AnyObject?,
       CFGetTypeID(main) == AXUIElementGetTypeID() {
        return (main as! AXUIElement)
    }
    return axChildren(appElement).first
}

private func windowNumber(_ element: AXUIElement) -> Int? {
    (axCopy(element, "AXWindowNumber" as CFString) as? NSNumber)?.intValue
}

private func sha256(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
}

private func observeSnapshot(app: NSRunningApplication, limits: [String: Any]) throws -> ObservationSnapshot {
    guard AXIsProcessTrusted() else {
        throw fail("COMPUTER_PERMISSION_REQUIRED", "macOS Accessibility permission is required for the DSH helper")
    }
    let maxNodes = try int(limits["maxNodes"], "limits.maxNodes")
    let maxDepth = try int(limits["maxDepth"], "limits.maxDepth")
    let maxTextBytes = try int(limits["maxTextBytes"], "limits.maxTextBytes")
    guard maxNodes > 0, maxDepth > 0, maxTextBytes > 0 else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "observation limits must be positive")
    }
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    let rootWindow = chosenWindow(appElement)
    let root = rootWindow ?? appElement
    let frame = rootWindow.flatMap(axFrame)
    let title = rootWindow.flatMap { axString($0, kAXTitleAttribute as CFString) }
    let windowId = rootWindow.flatMap(windowNumber)
    var windowJSON: [String: Any]?
    if let frame {
        var json: [String: Any] = ["frame": rectJSON(frame)]
        if let title { json["title"] = title }
        if let windowId { json["id"] = windowId }
        windowJSON = json
    }

    var queue: [(AXUIElement, [Int], Int)] = [(root, [], 0)]
    var cursor = 0
    var seen = Set<CFHashCode>()
    var records: [ElementRecord] = []
    var lines: [String] = []
    var textBytes = 0
    var truncated = false

    while cursor < queue.count {
        if records.count >= maxNodes { truncated = true; break }
        let (element, locator, depth) = queue[cursor]
        cursor += 1
        let identity = CFHash(element)
        if seen.contains(identity) { continue }
        seen.insert(identity)
        let role = axString(element, kAXRoleAttribute as CFString) ?? "AXUnknown"
        let subrole = axString(element, kAXSubroleAttribute as CFString)
        let titleValue = axString(element, kAXTitleAttribute as CFString)
        let descriptionValue = axString(element, kAXDescriptionAttribute as CFString)
        let labelValue = titleValue ?? descriptionValue
        let secure = role == "AXSecureTextField" || subrole == "AXSecureTextField"
        let valueValue: String? = secure ? "[secure]" : {
            guard let raw = axCopy(element, kAXValueAttribute as CFString) else { return nil }
            if let string = raw as? String { return sanitize(string) }
            if let number = raw as? NSNumber { return number.stringValue }
            return nil
        }()
        let enabled = axBool(element, kAXEnabledAttribute as CFString)
        let focused = axBool(element, kAXFocusedAttribute as CFString)
        let selected = axBool(element, kAXSelectedAttribute as CFString)
        let elementFrame = axFrame(element)
        let actions = axActions(element)
        let index = records.count
        var json: [String: Any] = [
            "index": index,
            "role": role,
            "actions": actions,
            "locator": locator,
        ]
        if let subrole { json["subrole"] = subrole }
        if let titleValue { json["title"] = sanitize(titleValue) }
        if let labelValue { json["label"] = sanitize(labelValue) }
        if let valueValue { json["value"] = valueValue }
        if let enabled { json["enabled"] = enabled }
        if let focused { json["focused"] = focused }
        if let selected { json["selected"] = selected }
        if let elementFrame { json["frame"] = rectJSON(elementFrame) }
        let frameKey = elementFrame.map { "\(Int($0.origin.x)),\(Int($0.origin.y)),\(Int($0.width)),\(Int($0.height))" } ?? ""
        let hashLine = [locator.map(String.init).joined(separator: "."), role, subrole ?? "", titleValue ?? "", labelValue ?? "", valueValue ?? "", String(enabled ?? true), String(focused ?? false), String(selected ?? false), frameKey, actions.joined(separator: ",")].joined(separator: "|")
        var line = String(repeating: "  ", count: min(depth, 20)) + "[\(index)] \(role)"
        if let titleValue { line += " \(jsonString(sanitize(titleValue)))" }
        else if let labelValue { line += " \(jsonString(sanitize(labelValue)))" }
        if let valueValue { line += " value=\(jsonString(valueValue))" }
        if enabled == false { line += " disabled" }
        if focused == true { line += " focused" }
        if selected == true { line += " selected" }
        let lineBytes = line.lengthOfBytes(using: .utf8) + (lines.isEmpty ? 0 : 1)
        if textBytes + lineBytes <= maxTextBytes {
            lines.append(line)
            textBytes += lineBytes
        } else {
            truncated = true
        }
        records.append(ElementRecord(index: index, locator: locator, element: element, json: json, hashLine: hashLine))
        if depth >= maxDepth {
            if !axChildren(element).isEmpty { truncated = true }
            continue
        }
        for (childIndex, child) in axChildren(element).enumerated() {
            queue.append((child, locator + [childIndex], depth + 1))
        }
    }
    let appData = try appJSON(app)
    let windowHash = [
        title ?? "",
        windowId.map(String.init) ?? "",
        frame.map { "\(Int($0.origin.x)),\(Int($0.origin.y)),\(Int($0.width)),\(Int($0.height))" } ?? "",
    ].joined(separator: "|")
    let state = [appData["bundleId"] as? String ?? "", String(app.processIdentifier), windowHash, records.map(\.hashLine).joined(separator: "\n")].joined(separator: "\n")
    return ObservationSnapshot(
        app: app,
        appJSON: appData,
        frontmost: app.isActive,
        window: rootWindow,
        windowJSON: windowJSON,
        stateHash: sha256(state),
        treeText: lines.joined(separator: "\n"),
        truncated: truncated,
        elements: records
    )
}

private func captureWindow(_ snapshot: ObservationSnapshot, path: String, required: Bool) async throws -> [String: Any]? {
    guard CGPreflightScreenCaptureAccess() else {
        if required { throw fail("COMPUTER_PERMISSION_REQUIRED", "macOS Screen Recording permission is required for screenshots") }
        return nil
    }
    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    } catch {
        if required { throw fail("COMPUTER_PROVIDER_FAILURE", "ScreenCaptureKit could not enumerate windows") }
        return nil
    }
    let expectedId = (snapshot.windowJSON?["id"] as? NSNumber)?.uint32Value
    let expectedTitle = snapshot.windowJSON?["title"] as? String
    let windows = content.windows.filter { $0.owningApplication?.processID == snapshot.app.processIdentifier }
    let selected = windows.first { window in
        if let expectedId, window.windowID == expectedId { return true }
        if let expectedTitle, !expectedTitle.isEmpty, window.title == expectedTitle { return true }
        return false
    } ?? windows.max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
    guard let selected else {
        if required { throw fail("COMPUTER_TARGET_UNAVAILABLE", "no capturable window belongs to the selected application") }
        return nil
    }
    let configuration = SCStreamConfiguration()
    configuration.width = max(1, Int(selected.frame.width.rounded()))
    configuration.height = max(1, Int(selected.frame.height.rounded()))
    configuration.showsCursor = false
    let filter = SCContentFilter(desktopIndependentWindow: selected)
    let image: CGImage
    do {
        image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    } catch {
        if required { throw fail("COMPUTER_PROVIDER_FAILURE", "ScreenCaptureKit could not capture the selected window") }
        return nil
    }
    let representation = NSBitmapImageRep(cgImage: image)
    guard let data = representation.representation(using: .png, properties: [:]) else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "captured window could not be encoded as PNG")
    }
    do {
        try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    } catch {
        throw fail("COMPUTER_PROVIDER_FAILURE", "captured PNG could not be written")
    }
    return ["path": path, "width": image.width, "height": image.height]
}

private func observationJSON(_ snapshot: ObservationSnapshot, screenshot: [String: Any]?) -> [String: Any] {
    var result: [String: Any] = [
        "app": snapshot.appJSON,
        "stateHash": snapshot.stateHash,
        "frontmost": snapshot.frontmost,
        "treeText": snapshot.treeText,
        "truncated": snapshot.truncated,
        "elements": snapshot.elements.map(\.json),
        "permissions": [
            "accessibility": permissionAccessibility(),
            "screenRecording": permissionScreenRecording(),
        ],
    ]
    if let window = snapshot.windowJSON { result["window"] = window }
    if let screenshot { result["screenshot"] = screenshot }
    return result
}

private func activate(_ app: NSRunningApplication, timeoutMs: Int) throws {
    _ = app.activate(options: [.activateAllWindows])
    let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(timeoutMs) * 1_000_000
    while !app.isActive {
        if DispatchTime.now().uptimeNanoseconds >= deadline {
            throw fail("COMPUTER_ACTION_BLOCKED", "the selected application did not become frontmost before the action timeout")
        }
        usleep(10_000)
    }
}

private func eventSource() throws -> CGEventSource {
    guard let source = CGEventSource(stateID: .combinedSessionState) else {
        throw fail("COMPUTER_ACTION_BLOCKED", "CoreGraphics input event source is unavailable")
    }
    return source
}

private func clickPoint(_ point: CGPoint, button: CGMouseButton, count: Int) throws {
    let source = try eventSource()
    let downType: CGEventType = button == .right ? .rightMouseDown : button == .center ? .otherMouseDown : .leftMouseDown
    let upType: CGEventType = button == .right ? .rightMouseUp : button == .center ? .otherMouseUp : .leftMouseUp
    guard let down = CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: button),
          let up = CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: button) else {
        throw fail("COMPUTER_ACTION_BLOCKED", "CoreGraphics could not create click events")
    }
    down.setIntegerValueField(.mouseEventClickState, value: Int64(count))
    up.setIntegerValueField(.mouseEventClickState, value: Int64(count))
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

private func windowPoint(_ action: [String: Any], window: [String: Any]?, xKey: String, yKey: String) throws -> CGPoint {
    guard let frame = window?["frame"] as? [String: Any] else {
        throw fail("COMPUTER_TARGET_UNAVAILABLE", "the observation has no current window coordinate space")
    }
    let x = try double(action[xKey], "action.\(xKey)")
    let y = try double(action[yKey], "action.\(yKey)")
    let width = try double(frame["width"], "window.width")
    let height = try double(frame["height"], "window.height")
    guard x >= 0, y >= 0, x <= width, y <= height else {
        throw fail("COMPUTER_TARGET_UNAVAILABLE", "coordinate is outside the observed window")
    }
    return CGPoint(x: try double(frame["x"], "window.x") + x, y: try double(frame["y"], "window.y") + y)
}

private func mouseButton(_ value: String?) throws -> CGMouseButton {
    switch value ?? "left" {
    case "left": return .left
    case "right": return .right
    case "middle": return .center
    default: throw fail("COMPUTER_PROVIDER_FAILURE", "unsupported mouse button")
    }
}

private let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19,
    "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28,
    "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "return": 36,
    "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45,
    "m": 46, ".": 47, "tab": 48, "space": 49, "delete": 51, "escape": 53,
    "home": 115, "pageup": 116, "forwarddelete": 117, "end": 119, "pagedown": 121,
    "left": 123, "right": 124, "down": 125, "up": 126,
]

private func flags(_ modifiers: [String]) throws -> CGEventFlags {
    var result: CGEventFlags = []
    for modifier in modifiers {
        switch modifier {
        case "command": result.insert(.maskCommand)
        case "control": result.insert(.maskControl)
        case "option": result.insert(.maskAlternate)
        case "shift": result.insert(.maskShift)
        default: throw fail("COMPUTER_PROVIDER_FAILURE", "unsupported key modifier")
        }
    }
    return result
}

private func pressKey(_ key: String, modifiers: [String], app: NSRunningApplication) throws {
    let normalized = key.lowercased()
    guard let code = keyCodes[normalized] else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "unsupported key; use the documented key vocabulary")
    }
    let source = try eventSource()
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {
        throw fail("COMPUTER_ACTION_BLOCKED", "CoreGraphics could not create keyboard events")
    }
    let eventFlags = try flags(modifiers)
    down.flags = eventFlags
    up.flags = eventFlags
    down.postToPid(app.processIdentifier)
    usleep(5_000)
    up.postToPid(app.processIdentifier)
}

private func focusedElement(_ app: NSRunningApplication) -> AXUIElement? {
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    guard let focused = axCopy(appElement, kAXFocusedUIElementAttribute as CFString) as AnyObject?,
          CFGetTypeID(focused) == AXUIElementGetTypeID() else { return nil }
    return (focused as! AXUIElement)
}

private func typeText(_ text: String, app: NSRunningApplication) throws -> String {
    if let focused = focusedElement(app),
       AXUIElementSetAttributeValue(focused, kAXSelectedTextAttribute as CFString, text as CFTypeRef) == .success {
        return "accessibility"
    }
    let source = try eventSource()
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
        throw fail("COMPUTER_ACTION_BLOCKED", "CoreGraphics could not create Unicode keyboard events")
    }
    let units = Array(text.utf16)
    units.withUnsafeBufferPointer { buffer in
        down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress!)
        up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress!)
    }
    down.postToPid(app.processIdentifier)
    usleep(5_000)
    up.postToPid(app.processIdentifier)
    return "keyboard"
}

private func targetRecord(_ request: [String: Any], snapshot: ObservationSnapshot) throws -> ElementRecord? {
    guard let element = request["element"] as? [String: Any] else { return nil }
    let locator = (element["locator"] as? [NSNumber])?.map(\.intValue) ?? []
    guard let record = snapshot.elements.first(where: { $0.locator == locator }) else {
        throw fail("COMPUTER_STALE_OBSERVATION", "the target element locator is no longer present")
    }
    return record
}

private func selectedIdentity(_ source: [String: Any], keys: [String]) -> [AnyHashable: Any] {
    var identity: [AnyHashable: Any] = [:]
    for key in keys {
        if let value = source[key] { identity[key] = value }
    }
    return identity
}

private func targetMatches(_ expected: [String: Any], current: ElementRecord) -> Bool {
    let keys = ["role", "subrole", "title", "label", "value", "enabled", "selected", "frame", "actions"]
    return NSDictionary(dictionary: selectedIdentity(expected, keys: keys))
        .isEqual(to: selectedIdentity(current.json, keys: keys))
}

private func windowMatches(_ expected: [String: Any]?, current: [String: Any]?) -> Bool {
    guard let expected else { return current == nil }
    guard let current else { return false }
    let keys = ["id", "title", "frame"]
    return NSDictionary(dictionary: selectedIdentity(expected, keys: keys))
        .isEqual(to: selectedIdentity(current, keys: keys))
}

private func performAction(_ request: [String: Any]) throws -> [String: Any] {
    let appIdentity = try dictionary(request["app"], "request.app")
    let selector: [String: Any] = [
        "bundleId": try string(appIdentity["bundleId"], "app.bundleId"),
        "pid": try int(appIdentity["pid"], "app.pid"),
    ]
    let app = try resolveApp(selector)
    let limits = try dictionary(request["limits"], "request.limits")
    let snapshot = try observeSnapshot(app: app, limits: limits)
    let expected = try string(request["expectedStateHash"], "request.expectedStateHash")
    let action = try dictionary(request["action"], "request.action")
    let kind = try string(action["kind"], "action.kind")
    let actionTimeoutMs = try int(request["actionTimeoutMs"], "request.actionTimeoutMs")
    guard actionTimeoutMs >= 1_000 && actionTimeoutMs <= 120_000 else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "request.actionTimeoutMs must be between 1000 and 120000")
    }
    let record = try targetRecord(request, snapshot: snapshot)
    if let record, let expectedElement = request["element"] as? [String: Any] {
        guard windowMatches(request["window"] as? [String: Any], current: snapshot.windowJSON),
              targetMatches(expectedElement, current: record) else {
            throw fail("COMPUTER_STALE_OBSERVATION", "the target element or window changed after the referenced observation")
        }
    } else if snapshot.stateHash != expected {
        throw fail("COMPUTER_STALE_OBSERVATION", "the application UI changed after the referenced observation")
    }
    try activate(app, timeoutMs: actionTimeoutMs)
    switch kind {
    case "click":
        if let record, let available = record.json["actions"] as? [String], available.contains(kAXPressAction as String) {
            let result = AXUIElementPerformAction(record.element, kAXPressAction as CFString)
            guard result == .success else { throw fail("COMPUTER_ACTION_BLOCKED", "Accessibility press was rejected") }
            return ["channel": "accessibility"]
        }
        if let record, bool(action["allowCoordinateFallback"]), let frame = axFrame(record.element) {
            try clickPoint(CGPoint(x: frame.midX, y: frame.midY), button: try mouseButton(action["button"] as? String), count: min(max((action["clickCount"] as? NSNumber)?.intValue ?? 1, 1), 3))
            return ["channel": "coordinates"]
        }
        if action["x"] != nil, action["y"] != nil {
            let point = try windowPoint(action, window: snapshot.windowJSON, xKey: "x", yKey: "y")
            try clickPoint(point, button: try mouseButton(action["button"] as? String), count: min(max((action["clickCount"] as? NSNumber)?.intValue ?? 1, 1), 3))
            return ["channel": "coordinates"]
        }
        throw fail("COMPUTER_ELEMENT_UNAVAILABLE", "element does not support AXPress and coordinate fallback was not available")
    case "set-value":
        guard let record else { throw fail("COMPUTER_ELEMENT_UNAVAILABLE", "set-value requires an observed element") }
        let value = try stringAllowingEmpty(action["value"], "action.value")
        let result = AXUIElementSetAttributeValue(record.element, kAXValueAttribute as CFString, value as CFTypeRef)
        guard result == .success else { throw fail("COMPUTER_ACTION_BLOCKED", "Accessibility value assignment was rejected") }
        return ["channel": "accessibility"]
    case "type-text":
        return ["channel": try typeText(try string(action["text"], "action.text"), app: app)]
    case "press-key":
        let modifiers = action["modifiers"] as? [String] ?? []
        try pressKey(try string(action["key"], "action.key"), modifiers: modifiers, app: app)
        return ["channel": "keyboard"]
    case "scroll":
        let point: CGPoint
        if let record, let frame = axFrame(record.element) { point = CGPoint(x: frame.midX, y: frame.midY) }
        else { point = try windowPoint(action, window: snapshot.windowJSON, xKey: "x", yKey: "y") }
        let direction = try string(action["direction"], "action.direction")
        let pages = min(max((action["pages"] as? NSNumber)?.intValue ?? 1, 1), 10)
        let vertical = direction == "up" ? 10 * pages : direction == "down" ? -10 * pages : 0
        let horizontal = direction == "left" ? 10 * pages : direction == "right" ? -10 * pages : 0
        guard vertical != 0 || horizontal != 0 else { throw fail("COMPUTER_PROVIDER_FAILURE", "unsupported scroll direction") }
        CGWarpMouseCursorPosition(point)
        guard let event = CGEvent(scrollWheelEvent2Source: try eventSource(), units: .line, wheelCount: 2, wheel1: Int32(vertical), wheel2: Int32(horizontal), wheel3: 0) else {
            throw fail("COMPUTER_ACTION_BLOCKED", "CoreGraphics could not create scroll event")
        }
        event.post(tap: .cghidEventTap)
        return ["channel": "coordinates"]
    case "drag":
        let from = try windowPoint(action, window: snapshot.windowJSON, xKey: "fromX", yKey: "fromY")
        let to = try windowPoint(action, window: snapshot.windowJSON, xKey: "toX", yKey: "toY")
        let source = try eventSource()
        guard let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: from, mouseButton: .left),
              let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left),
              let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left) else {
            throw fail("COMPUTER_ACTION_BLOCKED", "CoreGraphics could not create drag events")
        }
        move.post(tap: .cghidEventTap)
        down.post(tap: .cghidEventTap)
        for step in 1...12 {
            let fraction = CGFloat(step) / 12
            let point = CGPoint(x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction)
            CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
            usleep(8_000)
        }
        up.post(tap: .cghidEventTap)
        return ["channel": "coordinates"]
    case "perform-action":
        guard let record else { throw fail("COMPUTER_ELEMENT_UNAVAILABLE", "perform-action requires an observed element") }
        let actionName = try string(action["action"], "action.action")
        let available = record.json["actions"] as? [String] ?? []
        guard available.contains(actionName) else { throw fail("COMPUTER_ELEMENT_UNAVAILABLE", "the element did not advertise the requested Accessibility action") }
        let result = AXUIElementPerformAction(record.element, actionName as CFString)
        guard result == .success else { throw fail("COMPUTER_ACTION_BLOCKED", "Accessibility action was rejected") }
        return ["channel": "accessibility"]
    default:
        throw fail("COMPUTER_PROVIDER_FAILURE", "unsupported action kind")
    }
}

private func handle(_ request: [String: Any]) async throws -> Any {
    guard (request["protocolVersion"] as? NSNumber)?.intValue == 1 else {
        throw fail("COMPUTER_PROVIDER_FAILURE", "unsupported helper protocol version")
    }
    let command = try string(request["command"], "command")
    switch command {
    case "health":
        return [
            "helperVersion": helperVersion,
            "accessibility": permissionAccessibility(),
            "screenRecording": permissionScreenRecording(),
        ]
    case "list-apps":
        return try runningApps().map { app -> [String: Any] in
            var json = try appJSON(app)
            json["frontmost"] = app.isActive
            json["accessibility"] = permissionAccessibility()
            json["screenRecording"] = permissionScreenRecording()
            return json
        }
    case "resolve-app":
        return try appJSON(resolveApp(try dictionary(request["selector"], "selector")))
    case "open-settings":
        let kind = try string(request["kind"], "kind")
        let target: String
        switch kind {
        case "accessibility":
            target = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        case "screen-recording":
            target = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        default:
            throw fail("COMPUTER_PROVIDER_FAILURE", "unknown permission Settings pane")
        }
        guard let url = URL(string: target), NSWorkspace.shared.open(url) else {
            throw fail("COMPUTER_ACTION_BLOCKED", "macOS Settings could not be opened")
        }
        return NSNull()
    case "observe":
        let appIdentity = try dictionary(request["app"], "app")
        let app = try resolveApp([
            "bundleId": try string(appIdentity["bundleId"], "app.bundleId"),
            "pid": try int(appIdentity["pid"], "app.pid"),
        ])
        let options = try dictionary(request["options"], "options")
        let snapshot = try observeSnapshot(app: app, limits: options)
        let mode = options["screenshot"] as? String ?? "optional"
        var screenshot: [String: Any]?
        if mode != "none" {
            let path = try string(options["screenshotPath"], "options.screenshotPath")
            screenshot = try await captureWindow(snapshot, path: path, required: mode == "required")
        }
        return observationJSON(snapshot, screenshot: screenshot)
    case "act":
        return try performAction(try dictionary(request["request"], "request"))
    default:
        throw fail("COMPUTER_PROVIDER_FAILURE", "unknown helper command")
    }
}

private func emit(_ payload: [String: Any], exitCode: Int32) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])) ?? Data("{\"ok\":false,\"error\":{\"code\":\"COMPUTER_PROVIDER_FAILURE\",\"message\":\"response serialization failed\"}}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    Darwin.exit(exitCode)
}

@main
private struct HelperMain {
    @MainActor
    static func main() async {
        do {
            _ = NSApplication.shared
            NSApplication.shared.setActivationPolicy(.prohibited)
            guard let data = try FileHandle.standardInput.readToEnd(), !data.isEmpty,
                  let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw fail("COMPUTER_PROVIDER_FAILURE", "stdin must contain one JSON request")
            }
            let value = try await handle(request)
            emit(["ok": true, "value": value], exitCode: 0)
        } catch let error as HelperError {
            emit(["ok": false, "error": ["code": error.code, "message": error.message]], exitCode: 2)
        } catch {
            emit(["ok": false, "error": ["code": "COMPUTER_PROVIDER_FAILURE", "message": String(describing: error).prefix(1000).description]], exitCode: 2)
        }
    }
}
