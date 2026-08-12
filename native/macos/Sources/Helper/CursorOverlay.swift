import AppKit
import CoreGraphics
import Darwin
import Foundation
import QuartzCore

private struct CursorOverlayCommand {
    let operation: String
    let point: CGPoint?
    let durationMs: Int
    let autoHideMs: Int
    let targetPid: pid_t?
    let targetWindowNumber: Int64?
    let targetWindowFrame: CGRect?
    let sustainedPress: Bool

    private static let maximumCoordinateMagnitude = 100_000.0
    private static let maximumDurationMs = 2_000
    private static let maximumAutoHideMs = 30_000

    private static func number(_ object: Any?, field: String) throws -> NSNumber? {
        guard let object else { return nil }
        guard let value = object as? NSNumber,
              CFGetTypeID(value) != CFBooleanGetTypeID() else {
            throw CursorOverlayError(message: "cursor overlay \(field) must be numeric")
        }
        return value
    }

    private static func integer(_ object: Any?, field: String, fallback: Int) throws -> Int {
        guard let value = try number(object, field: field) else { return fallback }
        let doubleValue = value.doubleValue
        guard doubleValue.isFinite, doubleValue.rounded(.towardZero) == doubleValue,
              doubleValue >= Double(Int.min), doubleValue <= Double(Int.max) else {
            throw CursorOverlayError(message: "cursor overlay \(field) must be an integer")
        }
        return Int(doubleValue)
    }

    init(_ object: [String: Any]) throws {
        guard let operation = object["op"] as? String else {
            throw CursorOverlayError(message: "cursor overlay command is missing op")
        }
        self.operation = operation
        let x = try Self.number(object["x"], field: "x")
        let y = try Self.number(object["y"], field: "y")
        if let x, let y {
            let xValue = x.doubleValue
            let yValue = y.doubleValue
            guard xValue.isFinite, yValue.isFinite,
                  abs(xValue) <= Self.maximumCoordinateMagnitude,
                  abs(yValue) <= Self.maximumCoordinateMagnitude else {
                throw CursorOverlayError(message: "cursor overlay coordinates are outside the supported range")
            }
            self.point = CGPoint(x: xValue, y: yValue)
        } else {
            self.point = nil
        }
        let durationMs = try Self.integer(object["durationMs"], field: "durationMs", fallback: 180)
        let autoHideMs = try Self.integer(object["autoHideMs"], field: "autoHideMs", fallback: 0)
        guard durationMs >= 0, durationMs <= Self.maximumDurationMs,
              autoHideMs >= 0, autoHideMs <= Self.maximumAutoHideMs else {
            throw CursorOverlayError(message: "cursor overlay timing is outside the supported range")
        }
        self.durationMs = durationMs
        self.autoHideMs = autoHideMs

        if let rawPid = try Self.number(object["targetPid"], field: "targetPid") {
            let pidValue = rawPid.doubleValue
            guard pidValue.isFinite, pidValue.rounded(.towardZero) == pidValue,
                  pidValue > 0, pidValue <= Double(Int32.max) else {
                throw CursorOverlayError(message: "cursor overlay targetPid is invalid")
            }
            self.targetPid = pid_t(pidValue)
        } else {
            self.targetPid = nil
        }
        if let rawWindowNumber = try Self.number(object["targetWindowNumber"], field: "targetWindowNumber") {
            let windowValue = rawWindowNumber.doubleValue
            guard windowValue.isFinite, windowValue.rounded(.towardZero) == windowValue,
                  windowValue > 0, windowValue <= Double(Int64.max) else {
                throw CursorOverlayError(message: "cursor overlay targetWindowNumber is invalid")
            }
            self.targetWindowNumber = Int64(windowValue)
        } else {
            self.targetWindowNumber = nil
        }
        if let frame = object["targetWindowFrame"] as? [String: Any] {
            guard let x = try Self.number(frame["x"], field: "targetWindowFrame.x"),
                  let y = try Self.number(frame["y"], field: "targetWindowFrame.y"),
                  let width = try Self.number(frame["width"], field: "targetWindowFrame.width"),
                  let height = try Self.number(frame["height"], field: "targetWindowFrame.height") else {
                throw CursorOverlayError(message: "cursor overlay targetWindowFrame is incomplete")
            }
            let values = [x.doubleValue, y.doubleValue, width.doubleValue, height.doubleValue]
            guard values.allSatisfy(\.isFinite), width.doubleValue > 0, height.doubleValue > 0,
                  values.allSatisfy({ abs($0) <= Self.maximumCoordinateMagnitude }) else {
                throw CursorOverlayError(message: "cursor overlay targetWindowFrame is invalid")
            }
            self.targetWindowFrame = CGRect(
                x: x.doubleValue,
                y: y.doubleValue,
                width: width.doubleValue,
                height: height.doubleValue
            )
        } else {
            self.targetWindowFrame = nil
        }
        if let sustainedPress = object["sustainedPress"] {
            guard let value = sustainedPress as? Bool else {
                throw CursorOverlayError(message: "cursor overlay sustainedPress must be boolean")
            }
            self.sustainedPress = value
        } else {
            self.sustainedPress = false
        }
    }
}

private struct CursorOverlayError: Error {
    let message: String
}

private final class CursorPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class CursorView: NSView {
    override var isFlipped: Bool { true }

    private let image: NSImage? = EmbeddedCursorImage.image

    var pressed = false {
        didSet { needsDisplay = true }
    }

    override var isOpaque: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let image else { return }
        let imageRect = pressed ? bounds.insetBy(dx: 2, dy: 2) : bounds
        image.draw(
            in: imageRect,
            from: .zero,
            operation: .sourceOver,
            fraction: pressed ? 0.85 : 1,
            respectFlipped: true,
            hints: nil
        )
    }
}

@MainActor
private final class CursorOverlayController: NSObject {
    private static let size = NSSize(width: 28, height: 28)

    private let window: CursorPanel
    private let cursorView: CursorView
    private var hideWork: DispatchWorkItem?
    private var releaseWork: DispatchWorkItem?
    private var targetCheckTimer: Timer?
    private var targetPid: pid_t?
    private var targetWindowNumber: Int64?
    private var targetWindowFrame: CGRect?

    override init() {
        cursorView = CursorView(frame: NSRect(origin: .zero, size: Self.size))
        window = CursorPanel(
            contentRect: NSRect(origin: .zero, size: Self.size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        super.init()
        window.title = "DSH Computer Use Cursor"
        window.contentView = cursorView
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.hidesOnDeactivate = false
        window.becomesKeyOnlyIfNeeded = true
        window.level = .floating
        window.collectionBehavior = [.fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.isReleasedWhenClosed = false
        window.sharingType = .readOnly
    }

    func show(
        at quartzPoint: CGPoint,
        durationMs: Int,
        autoHideMs: Int,
        targetPid: pid_t?,
        targetWindowNumber: Int64?,
        targetWindowFrame: CGRect?
    ) {
        hideWork?.cancel()
        guard targetWindowIsCurrent(pid: targetPid, windowNumber: targetWindowNumber, expectedFrame: targetWindowFrame) else {
            hide()
            return
        }
        self.targetPid = targetPid
        self.targetWindowNumber = targetWindowNumber
        self.targetWindowFrame = targetWindowFrame
        scheduleTargetChecks()
        let point = appKitPoint(fromQuartz: quartzPoint)
        let targetOrigin = NSPoint(
            x: point.x,
            y: point.y - Self.size.height
        )
        if window.isVisible && durationMs > 0 {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = Double(durationMs) / 1000
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                window.animator().setFrameOrigin(targetOrigin)
            }
        } else {
            window.setFrameOrigin(targetOrigin)
            window.orderFrontRegardless()
        }
        scheduleHide(after: autoHideMs)
    }

    func press(autoHideMs: Int, sustained: Bool) {
        guard window.isVisible else { return }
        releaseWork?.cancel()
        releaseWork = nil
        cursorView.pressed = true
        if !sustained {
            let work = DispatchWorkItem { [weak self] in
                self?.cursorView.pressed = false
            }
            releaseWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(150), execute: work)
        }
        scheduleHide(after: autoHideMs)
    }

    func release(autoHideMs: Int) {
        releaseWork?.cancel()
        releaseWork = nil
        cursorView.pressed = false
        scheduleHide(after: autoHideMs)
    }

    func validateTarget(pid: pid_t?, windowNumber: Int64?, expectedFrame: CGRect?) {
        guard window.isVisible else { return }
        if !targetWindowIsCurrent(pid: pid, windowNumber: windowNumber, expectedFrame: expectedFrame) { hide() }
    }

    func hide() {
        hideWork?.cancel()
        hideWork = nil
        releaseWork?.cancel()
        releaseWork = nil
        targetCheckTimer?.invalidate()
        targetCheckTimer = nil
        targetPid = nil
        targetWindowNumber = nil
        targetWindowFrame = nil
        cursorView.pressed = false
        window.orderOut(nil)
    }

    func stop() {
        hide()
        NSApp.stop(nil)
        if let wakeEvent = NSEvent.otherEvent(
            with: .applicationDefined,
            location: .zero,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: 0,
            context: nil,
            subtype: 0,
            data1: 0,
            data2: 0
        ) {
            NSApp.postEvent(wakeEvent, atStart: true)
        }
    }

    private func scheduleHide(after milliseconds: Int) {
        hideWork?.cancel()
        guard milliseconds > 0 else { return }
        let work = DispatchWorkItem { [weak self] in self?.hide() }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(milliseconds), execute: work)
    }

    private func scheduleTargetChecks() {
        guard targetCheckTimer == nil else { return }
        targetCheckTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.window.isVisible else { return }
                if !self.targetWindowIsCurrent(
                    pid: self.targetPid,
                    windowNumber: self.targetWindowNumber,
                    expectedFrame: self.targetWindowFrame
                ) {
                    self.hide()
                }
            }
        }
    }

    private func appKitPoint(fromQuartz point: CGPoint) -> NSPoint {
        for screen in NSScreen.screens {
            guard let screenNumber = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value else {
                continue
            }
            let quartzFrame = CGDisplayBounds(CGDirectDisplayID(screenNumber))
            if quartzFrame.contains(point) {
                return NSPoint(
                    x: screen.frame.origin.x + (point.x - quartzFrame.origin.x),
                    y: screen.frame.maxY - (point.y - quartzFrame.origin.y)
                )
            }
        }
        let mainDisplay = CGMainDisplayID()
        let quartzFrame = CGDisplayBounds(mainDisplay)
        let screen = NSScreen.screens.first { candidate in
            (candidate.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == mainDisplay
        } ?? NSScreen.main
        let appKitFrame = screen?.frame ?? .zero
        return NSPoint(
            x: appKitFrame.origin.x + (point.x - quartzFrame.origin.x),
            y: appKitFrame.maxY - (point.y - quartzFrame.origin.y)
        )
    }

    private func targetWindowIsCurrent(pid: pid_t?, windowNumber: Int64?, expectedFrame: CGRect?) -> Bool {
        guard let pid, let windowNumber, let expectedFrame else { return false }
        guard let rawWindows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else {
            return false
        }
        return rawWindows.contains { window in
            guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
                  (window[kCGWindowNumber as String] as? NSNumber)?.int64Value == windowNumber,
                  let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let currentFrame = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }
            let tolerance: CGFloat = 2
            return abs(currentFrame.minX - expectedFrame.minX) <= tolerance
                && abs(currentFrame.minY - expectedFrame.minY) <= tolerance
                && abs(currentFrame.width - expectedFrame.width) <= tolerance
                && abs(currentFrame.height - expectedFrame.height) <= tolerance
        }
    }
}

@MainActor
enum CursorOverlayRuntime {
    static func run() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let controller = CursorOverlayController()
        let input = FileHandle.standardInput
        let parser = CursorCommandParser { object in
            DispatchQueue.main.async {
                handleCursorCommand(object, controller: controller)
            }
        } onEnd: {
            DispatchQueue.main.async { controller.stop() }
        } onInvalid: { message in
            DispatchQueue.main.async {
                emitCursorResponse(["ok": false, "error": message])
                controller.stop()
            }
        }
        input.readabilityHandler = { handle in parser.consume(handle.availableData) }
        emitCursorResponse(["ok": true, "ready": true, "pid": ProcessInfo.processInfo.processIdentifier])
        app.run()
        input.readabilityHandler = nil
    }
}

private final class CursorCommandParser: @unchecked Sendable {
    private static let maximumLineBytes = 16 * 1024
    private let queue = DispatchQueue(label: "dsh-computer-use.cursor-protocol")
    private let onObject: @Sendable ([String: Any]) -> Void
    private let onEnd: @Sendable () -> Void
    private let onInvalid: @Sendable (String) -> Void
    private var buffer = Data()
    private var ended = false

    init(
        onObject: @escaping @Sendable ([String: Any]) -> Void,
        onEnd: @escaping @Sendable () -> Void,
        onInvalid: @escaping @Sendable (String) -> Void
    ) {
        self.onObject = onObject
        self.onEnd = onEnd
        self.onInvalid = onInvalid
    }

    func consume(_ data: Data) {
        queue.async { [self] in
            guard !ended, !data.isEmpty else {
                guard !ended else { return }
                ended = true
                onEnd()
                return
            }
            buffer.append(data)
            if buffer.count > Self.maximumLineBytes, buffer.firstIndex(of: 0x0a) == nil {
                ended = true
                buffer.removeAll()
                onInvalid("cursor overlay command exceeded the protocol limit")
                return
            }
            while let newline = buffer.firstIndex(of: 0x0a) {
                let line = buffer[..<newline]
                buffer.removeSubrange(...newline)
                if line.count > Self.maximumLineBytes {
                    ended = true
                    onInvalid("cursor overlay command exceeded the protocol limit")
                    return
                }
                guard !line.isEmpty else { continue }
                guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else {
                    ended = true
                    onInvalid("cursor overlay command is not valid JSON")
                    return
                }
                onObject(object)
            }
        }
    }
}

@MainActor
private func handleCursorCommand(_ object: [String: Any], controller: CursorOverlayController) {
    do {
        let command = try CursorOverlayCommand(object)
        switch command.operation {
        case "show", "move":
            guard let point = command.point else {
                throw CursorOverlayError(message: "cursor overlay command needs x and y")
            }
            controller.show(
                at: point,
                durationMs: command.durationMs,
                autoHideMs: command.autoHideMs,
                targetPid: command.targetPid,
                targetWindowNumber: command.targetWindowNumber,
                targetWindowFrame: command.targetWindowFrame
            )
        case "press":
            controller.validateTarget(
                pid: command.targetPid,
                windowNumber: command.targetWindowNumber,
                expectedFrame: command.targetWindowFrame
            )
            controller.press(autoHideMs: command.autoHideMs, sustained: command.sustainedPress)
        case "release":
            controller.validateTarget(
                pid: command.targetPid,
                windowNumber: command.targetWindowNumber,
                expectedFrame: command.targetWindowFrame
            )
            controller.release(autoHideMs: command.autoHideMs)
        case "hide":
            controller.hide()
        case "stop":
            controller.stop()
        case "ping":
            break
        default:
            throw CursorOverlayError(message: "unknown cursor overlay operation")
        }
        emitCursorResponse(["ok": true, "op": command.operation])
    } catch let error as CursorOverlayError {
        emitCursorResponse(["ok": false, "error": error.message])
    } catch {
        emitCursorResponse(["ok": false, "error": String(describing: error)])
    }
}

private func emitCursorResponse(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}
