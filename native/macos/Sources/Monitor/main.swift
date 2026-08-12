import AppKit
import CoreGraphics
import Darwin
import Foundation

private func argument(_ name: String, default fallback: Int) -> Int {
    let values = ProcessInfo.processInfo.arguments
    guard let index = values.firstIndex(of: name), values.indices.contains(index + 1),
          let value = Int(values[index + 1]), value > 0 else { return fallback }
    return value
}

private func stringArgument(_ name: String) -> String? {
    let values = ProcessInfo.processInfo.arguments
    guard let index = values.firstIndex(of: name), values.indices.contains(index + 1) else { return nil }
    return values[index + 1]
}

private func optionalIntegerArgument(_ name: String) -> Int32? {
    guard let value = stringArgument(name), let parsed = Int32(value), parsed > 0 else { return nil }
    return parsed
}

private func cursorLocation() -> CGPoint {
    CGEvent(source: nil)?.location ?? .zero
}

private func frontmostPid() -> pid_t? {
    NSWorkspace.shared.frontmostApplication?.processIdentifier
}

private func matchingWindows(ownerPid: pid_t?, title: String?) -> [[String: Any]] {
    guard let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else { return [] }
    return windows.filter { window in
        if let ownerPid,
           (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value != ownerPid { return false }
        if let title,
           (window[kCGWindowName as String] as? String) != title { return false }
        return true
    }
}

private let durationMs = argument("--duration-ms", default: 1200)
private let intervalMicros = useconds_t(argument("--interval-micros", default: 1000))
private let windowOwnerPid = stringArgument("--window-owner-pid").flatMap { Int32($0) }
private let windowTitle = stringArgument("--window-title")
private let monitoredSourcePid = optionalIntegerArgument("--source-pid")
private let baselineCursor = cursorLocation()
private let baselineFrontmostPid = frontmostPid()
private var maximumCursorDistance = 0.0
private var observedFrontmostPids = Set<Int32>()
private var maximumMatchingWindowCount = 0
private var matchingWindowFrames: [[String: Any]] = []
private var monitoredSourcePointerEvents = 0
private var pointerEventSourceCounts: [String: Int] = [:]
private var samples = 0

private let pointerMask = [
    CGEventType.mouseMoved,
    .leftMouseDown,
    .leftMouseUp,
    .leftMouseDragged,
    .rightMouseDown,
    .rightMouseUp,
    .rightMouseDragged,
    .otherMouseDown,
    .otherMouseUp,
    .otherMouseDragged,
    .scrollWheel,
].reduce(CGEventMask(0)) { mask, type in
    mask | (CGEventMask(1) << type.rawValue)
}
private let eventTap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: pointerMask,
    callback: { _, _, event, _ in
        let sourcePid = event.getIntegerValueField(.eventSourceUnixProcessID)
        pointerEventSourceCounts[String(sourcePid), default: 0] += 1
        if let monitoredSourcePid, sourcePid == Int64(monitoredSourcePid) {
            monitoredSourcePointerEvents += 1
        }
        return Unmanaged.passUnretained(event)
    },
    userInfo: nil
)
private let eventTapSource = eventTap.map {
    CFMachPortCreateRunLoopSource(kCFAllocatorDefault, $0, 0)
}

if let eventTap, let eventTapSource {
    CFRunLoopAddSource(CFRunLoopGetCurrent(), eventTapSource, .defaultMode)
    CGEvent.tapEnable(tap: eventTap, enable: true)
}

if let baselineFrontmostPid { observedFrontmostPids.insert(baselineFrontmostPid) }
FileHandle.standardOutput.write(Data("READY\n".utf8))

let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(durationMs) * 1_000_000
while DispatchTime.now().uptimeNanoseconds < deadline {
    let location = cursorLocation()
    let distance = hypot(location.x - baselineCursor.x, location.y - baselineCursor.y)
    maximumCursorDistance = max(maximumCursorDistance, distance)
    if let pid = frontmostPid() { observedFrontmostPids.insert(pid) }
    let windows = matchingWindows(ownerPid: windowOwnerPid, title: windowTitle)
    maximumMatchingWindowCount = max(maximumMatchingWindowCount, windows.count)
    if let first = windows.first,
       let bounds = first[kCGWindowBounds as String] as? [String: Any] {
        matchingWindowFrames = [bounds]
    }
    samples += 1
    if eventTapSource != nil {
        CFRunLoopRunInMode(.defaultMode, Double(intervalMicros) / 1_000_000, true)
    } else {
        usleep(intervalMicros)
    }
}

let finalCursor = cursorLocation()
let result: [String: Any] = [
    "baselineCursor": ["x": baselineCursor.x, "y": baselineCursor.y],
    "finalCursor": ["x": finalCursor.x, "y": finalCursor.y],
    "maximumCursorDistance": maximumCursorDistance,
    "baselineFrontmostPid": baselineFrontmostPid.map(Int.init) as Any,
    "observedFrontmostPids": observedFrontmostPids.sorted().map(Int.init),
    "samples": samples,
    "maximumMatchingWindowCount": maximumMatchingWindowCount,
    "matchingWindowFrames": matchingWindowFrames,
    "eventTapAvailable": eventTap != nil,
    "monitoredSourcePointerEvents": monitoredSourcePointerEvents,
    "pointerEventSourceCounts": pointerEventSourceCounts,
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
