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

private func cursorLocation() -> CGPoint {
    CGEvent(source: nil)?.location ?? .zero
}

private func frontmostPid() -> pid_t? {
    NSWorkspace.shared.frontmostApplication?.processIdentifier
}

private let durationMs = argument("--duration-ms", default: 1200)
private let intervalMicros = useconds_t(argument("--interval-micros", default: 1000))
private let baselineCursor = cursorLocation()
private let baselineFrontmostPid = frontmostPid()
private var maximumCursorDistance = 0.0
private var observedFrontmostPids = Set<Int32>()
private var samples = 0

if let baselineFrontmostPid { observedFrontmostPids.insert(baselineFrontmostPid) }
FileHandle.standardOutput.write(Data("READY\n".utf8))

let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(durationMs) * 1_000_000
while DispatchTime.now().uptimeNanoseconds < deadline {
    let location = cursorLocation()
    let distance = hypot(location.x - baselineCursor.x, location.y - baselineCursor.y)
    maximumCursorDistance = max(maximumCursorDistance, distance)
    if let pid = frontmostPid() { observedFrontmostPids.insert(pid) }
    samples += 1
    usleep(intervalMicros)
}

let finalCursor = cursorLocation()
let result: [String: Any] = [
    "baselineCursor": ["x": baselineCursor.x, "y": baselineCursor.y],
    "finalCursor": ["x": finalCursor.x, "y": finalCursor.y],
    "maximumCursorDistance": maximumCursorDistance,
    "baselineFrontmostPid": baselineFrontmostPid.map(Int.init) as Any,
    "observedFrontmostPids": observedFrontmostPids.sorted().map(Int.init),
    "samples": samples,
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
