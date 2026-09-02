import AppKit
import CoreGraphics
import Darwin
import Foundation
import QuartzCore

private struct CursorOverlayCommand {
    let operation: String
    let point: CGPoint?
    let durationMs: Int?
    let speedPxPerSecond: Double?
    let accelerationPxPerSecondSquared: Double?
    let autoHideMs: Int
    let targetPid: pid_t?
    let targetWindowNumber: Int64?
    let targetWindowFrame: CGRect?
    let sustainedPress: Bool

    private static let maximumCoordinateMagnitude = 100_000.0
    private static let maximumDurationMs = 2_000
    private static let maximumSpeedPxPerSecond = 50_000.0
    private static let maximumAccelerationPxPerSecondSquared = 500_000.0
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
        let durationMs = object["durationMs"] == nil
            ? nil
            : try Self.integer(object["durationMs"], field: "durationMs", fallback: 180)
        let autoHideMs = try Self.integer(object["autoHideMs"], field: "autoHideMs", fallback: 0)
        guard durationMs == nil || (durationMs! >= 0 && durationMs! <= Self.maximumDurationMs),
              autoHideMs >= 0, autoHideMs <= Self.maximumAutoHideMs else {
            throw CursorOverlayError(message: "cursor overlay timing is outside the supported range")
        }
        self.durationMs = durationMs
        self.autoHideMs = autoHideMs
        let speed = try Self.number(object["speedPxPerSecond"], field: "speedPxPerSecond")?.doubleValue
        let acceleration = try Self.number(
            object["accelerationPxPerSecondSquared"],
            field: "accelerationPxPerSecondSquared"
        )?.doubleValue
        guard (speed == nil) == (acceleration == nil) else {
            throw CursorOverlayError(message: "cursor overlay speed and acceleration must be provided together")
        }
        guard speed == nil || (speed!.isFinite && speed! >= 100 && speed! <= Self.maximumSpeedPxPerSecond),
              acceleration == nil || (acceleration!.isFinite && acceleration! >= 100
                && acceleration! <= Self.maximumAccelerationPxPerSecondSquared) else {
            throw CursorOverlayError(message: "cursor overlay physical motion is outside the supported range")
        }
        self.speedPxPerSecond = speed
        self.accelerationPxPerSecondSquared = acceleration

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
    private var glideTimer: Timer?
    private var glideCompletion: ((Bool) -> Void)?
    private var hasPosition = false
    private var currentQuartzPoint: CGPoint?
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
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(frontmostApplicationChanged(_:)),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )
    }

    deinit {
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    /// Outcome of a placement request, so the caller can distinguish a cursor
    /// that moved from one that was hidden because its window binding no
    /// longer holds. Reporting success for the second is how a live session
    /// ends up with a frozen agent cursor and no error anywhere.
    enum Placement {
        case shown
        case targetNotFrontmost
        case targetUnavailable
    }

    func show(
        at quartzPoint: CGPoint,
        durationMs: Int?,
        speedPxPerSecond: Double?,
        accelerationPxPerSecondSquared: Double?,
        autoHideMs: Int,
        targetPid: pid_t?,
        targetWindowNumber: Int64?,
        targetWindowFrame: CGRect?,
        completion: @escaping (Placement) -> Void
    ) {
        hideWork?.cancel()
        let placement = targetPlacement(pid: targetPid, windowNumber: targetWindowNumber, expectedFrame: targetWindowFrame)
        guard placement == .shown else {
            hide()
            completion(placement)
            return
        }
        self.targetPid = targetPid
        self.targetWindowNumber = targetWindowNumber
        self.targetWindowFrame = targetWindowFrame
        scheduleTargetChecks()
        if !hasPosition {
            let mouse = NSEvent.mouseLocation
            window.setFrameOrigin(NSPoint(x: mouse.x, y: mouse.y - Self.size.height))
            currentQuartzPoint = self.quartzPoint(fromAppKit: mouse)
            hasPosition = true
        }
        window.orderFrontRegardless()
        let shownPlacement = targetPlacement(pid: targetPid, windowNumber: targetWindowNumber, expectedFrame: targetWindowFrame)
        guard shownPlacement == .shown else {
            hide()
            completion(shownPlacement)
            return
        }
        glide(
            from: currentQuartzPoint ?? quartzPoint,
            to: quartzPoint,
            durationMs: durationMs,
            speedPxPerSecond: speedPxPerSecond,
            accelerationPxPerSecondSquared: accelerationPxPerSecondSquared
        ) { [weak self] reached in
            guard let self else {
                completion(.targetUnavailable)
                return
            }
            let finalPlacement = self.targetPlacement(
                pid: targetPid,
                windowNumber: targetWindowNumber,
                expectedFrame: targetWindowFrame
            )
            guard reached, finalPlacement == .shown else {
                self.hide()
                completion(finalPlacement == .shown ? .targetUnavailable : finalPlacement)
                return
            }
            self.scheduleHide(after: autoHideMs)
            completion(.shown)
        }
    }

    /// Travel to `targetOrigin`, interpolated on the main run loop.
    ///
    /// `window.animator().setFrameOrigin` does not move this panel: the overlay
    /// runs with `.prohibited` activation policy, and the implicit animator
    /// silently does nothing there. Because the animated branch only ran once
    /// the panel was already visible, the first placement worked and every
    /// later move was a no-op — a cursor that appears once and then never
    /// follows the agent again.
    ///
    /// Stepping the origin directly is the same call the first placement
    /// already proved works, so the glide is both visible and correct.
    private func glide(
        from origin: CGPoint,
        to target: CGPoint,
        durationMs: Int?,
        speedPxPerSecond: Double?,
        accelerationPxPerSecondSquared: Double?,
        completion: @escaping (Bool) -> Void
    ) {
        finishGlide(reached: false)
        guard origin != target else {
            currentQuartzPoint = target
            window.setFrameOrigin(panelOrigin(fromQuartz: target))
            window.orderFrontRegardless()
            completion(true)
            return
        }
        let distance = hypot(target.x - origin.x, target.y - origin.y)
        let duration = motionDuration(
            distance: distance,
            explicitDurationMs: durationMs,
            speedPxPerSecond: speedPxPerSecond,
            accelerationPxPerSecondSquared: accelerationPxPerSecondSquared
        )
        guard duration > 0 else {
            currentQuartzPoint = target
            window.setFrameOrigin(panelOrigin(fromQuartz: target))
            window.orderFrontRegardless()
            completion(true)
            return
        }
        let started = CACurrentMediaTime()
        glideCompletion = completion
        let timer = Timer(timeInterval: 1.0 / 120.0, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { timer.invalidate(); return }
                if let targetPid = self.targetPid,
                   NSWorkspace.shared.frontmostApplication?.processIdentifier != targetPid {
                    self.hide()
                    return
                }
                let elapsed = CACurrentMediaTime() - started
                if elapsed >= duration {
                    self.currentQuartzPoint = target
                    self.window.setFrameOrigin(self.panelOrigin(fromQuartz: target))
                    self.hasPosition = true
                    self.finishGlide(reached: true)
                    return
                }
                let linear = elapsed / duration
                let fraction: Double
                if let speedPxPerSecond, let accelerationPxPerSecondSquared {
                    fraction = cursorMotionFraction(
                        progress: linear,
                        distance: distance,
                        speed: speedPxPerSecond,
                        acceleration: accelerationPxPerSecondSquared
                    )
                } else {
                    fraction = linear * linear * (3 - 2 * linear)
                }
                let point = cursorMotionPoint(from: origin, to: target, fraction: fraction)
                self.currentQuartzPoint = point
                self.window.setFrameOrigin(self.panelOrigin(fromQuartz: point))
            }
        }
        glideTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func motionDuration(
        distance: Double,
        explicitDurationMs: Int?,
        speedPxPerSecond: Double?,
        accelerationPxPerSecondSquared: Double?
    ) -> Double {
        if let explicitDurationMs { return Double(explicitDurationMs) / 1000 }
        guard let speedPxPerSecond, let accelerationPxPerSecondSquared else { return 0.18 }
        return cursorMotionDuration(
            distance: distance,
            speed: speedPxPerSecond,
            acceleration: accelerationPxPerSecondSquared
        )
    }

    private func finishGlide(reached: Bool) {
        glideTimer?.invalidate()
        glideTimer = nil
        let completion = glideCompletion
        glideCompletion = nil
        completion?(reached)
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

    var isVisible: Bool { window.isVisible }

    @discardableResult
    func validateTarget(pid: pid_t?, windowNumber: Int64?, expectedFrame: CGRect?) -> Placement {
        guard window.isVisible else { return .targetUnavailable }
        let placement = targetPlacement(pid: pid, windowNumber: windowNumber, expectedFrame: expectedFrame)
        if placement != .shown {
            hide()
            return placement
        }
        return .shown
    }

    func hide() {
        finishGlide(reached: false)
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
                if self.targetPlacement(
                    pid: self.targetPid,
                    windowNumber: self.targetWindowNumber,
                    expectedFrame: self.targetWindowFrame
                ) != .shown {
                    self.hide()
                }
            }
        }
    }

    @objc private func frontmostApplicationChanged(_ notification: Notification) {
        guard window.isVisible, let targetPid else { return }
        if NSWorkspace.shared.frontmostApplication?.processIdentifier != targetPid {
            hide()
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

    private func quartzPoint(fromAppKit point: NSPoint) -> CGPoint {
        for screen in NSScreen.screens {
            guard screen.frame.contains(point),
                  let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                continue
            }
            let quartzFrame = CGDisplayBounds(CGDirectDisplayID(screenNumber.uint32Value))
            return CGPoint(
                x: quartzFrame.origin.x + (point.x - screen.frame.origin.x),
                y: quartzFrame.origin.y + (screen.frame.maxY - point.y)
            )
        }
        let mainDisplay = CGMainDisplayID()
        let quartzFrame = CGDisplayBounds(mainDisplay)
        let appKitFrame = NSScreen.main?.frame ?? NSRect(
            x: quartzFrame.origin.x,
            y: quartzFrame.origin.y,
            width: quartzFrame.width,
            height: quartzFrame.height
        )
        return CGPoint(
            x: quartzFrame.origin.x + (point.x - appKitFrame.origin.x),
            y: quartzFrame.origin.y + (appKitFrame.maxY - point.y)
        )
    }

    private func panelOrigin(fromQuartz point: CGPoint) -> NSPoint {
        let appKit = appKitPoint(fromQuartz: point)
        return NSPoint(x: appKit.x, y: appKit.y - Self.size.height)
    }

    private func targetPlacement(pid: pid_t?, windowNumber: Int64?, expectedFrame: CGRect?) -> Placement {
        guard let pid, let windowNumber, let expectedFrame else { return .targetUnavailable }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return .targetNotFrontmost }
        guard let rawWindows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else {
            return .targetUnavailable
        }
        let matches = rawWindows.contains { window in
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
        return matches ? .shown : .targetUnavailable
    }
}

@MainActor
enum CursorOverlayRuntime {
    static func run() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let controller = CursorOverlayController()
        let dispatcher = CursorCommandDispatcher(controller: controller)
        let input = FileHandle.standardInput
        let parser = CursorCommandParser { object in
            DispatchQueue.main.async {
                dispatcher.enqueue(object)
            }
        } onEnd: {
            DispatchQueue.main.async { dispatcher.endInput() }
        } onInvalid: { message in
            DispatchQueue.main.async {
                dispatcher.invalidate(message)
            }
        }
        input.readabilityHandler = { handle in parser.consume(handle.availableData) }
        emitCursorResponse(["ok": true, "ready": true, "pid": ProcessInfo.processInfo.processIdentifier])
        app.run()
        input.readabilityHandler = nil
    }
}

@MainActor
private final class CursorCommandDispatcher {
    private let controller: CursorOverlayController
    private var commands: [[String: Any]] = []
    private var processing = false
    private var inputEnded = false
    private var terminated = false

    init(controller: CursorOverlayController) {
        self.controller = controller
    }

    func enqueue(_ object: [String: Any]) {
        guard !inputEnded, !terminated else { return }
        commands.append(object)
        if object["op"] as? String == "stop", processing {
            controller.hide()
        }
        drain()
    }

    func endInput() {
        guard !inputEnded, !terminated else { return }
        inputEnded = true
        if commands.contains(where: { $0["op"] as? String == "stop" }) {
            if processing { controller.hide() }
            drain()
        } else {
            terminated = true
            commands.removeAll()
            controller.stop()
        }
    }

    func invalidate(_ message: String) {
        guard !terminated else { return }
        inputEnded = true
        terminated = true
        commands.removeAll()
        controller.hide()
        emitCursorResponse(["ok": false, "error": message])
        controller.stop()
    }

    private func drain() {
        guard !terminated, !processing, !commands.isEmpty else { return }
        processing = true
        let command = commands.removeFirst()
        let stopsRuntime = command["op"] as? String == "stop"
        handleCursorCommand(command, controller: controller) { [weak self] in
            guard let self else { return }
            self.processing = false
            if stopsRuntime {
                self.terminated = true
                self.commands.removeAll()
                return
            }
            DispatchQueue.main.async { [weak self] in self?.drain() }
        }
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
private func handleCursorCommand(
    _ object: [String: Any],
    controller: CursorOverlayController,
    completion: @escaping () -> Void
) {
    do {
        let command = try CursorOverlayCommand(object)
        // Whether the panel is actually on screen after this command. A hidden
        // overlay still leaves native input working, so the operation is not an
        // error -- but the caller must be able to tell, or the user silently
        // loses sight of where the agent is acting.
        var visible = true
        var reasonCode: String?
        switch command.operation {
        case "show", "move":
            guard let point = command.point else {
                throw CursorOverlayError(message: "cursor overlay command needs x and y")
            }
            controller.show(
                at: point,
                durationMs: command.durationMs,
                speedPxPerSecond: command.speedPxPerSecond,
                accelerationPxPerSecondSquared: command.accelerationPxPerSecondSquared,
                autoHideMs: command.autoHideMs,
                targetPid: command.targetPid,
                targetWindowNumber: command.targetWindowNumber,
                targetWindowFrame: command.targetWindowFrame
            ) { placement in
                let shown = placement == .shown
                var response: [String: Any] = ["ok": true, "op": command.operation, "visible": shown]
                if !shown {
                    response["reasonCode"] = cursorReasonCode(placement)
                    response["reason"] = cursorReason(placement)
                }
                emitCursorResponse(response)
                completion()
            }
            return
        case "press":
            let placement = controller.validateTarget(
                pid: command.targetPid,
                windowNumber: command.targetWindowNumber,
                expectedFrame: command.targetWindowFrame
            )
            visible = placement == .shown
            reasonCode = cursorReasonCode(placement)
            controller.press(autoHideMs: command.autoHideMs, sustained: command.sustainedPress)
        case "release":
            let placement = controller.validateTarget(
                pid: command.targetPid,
                windowNumber: command.targetWindowNumber,
                expectedFrame: command.targetWindowFrame
            )
            visible = placement == .shown
            reasonCode = cursorReasonCode(placement)
            controller.release(autoHideMs: command.autoHideMs)
        case "validate":
            let placement = controller.validateTarget(
                pid: command.targetPid,
                windowNumber: command.targetWindowNumber,
                expectedFrame: command.targetWindowFrame
            )
            visible = placement == .shown
            reasonCode = cursorReasonCode(placement)
        case "hide":
            controller.hide()
            visible = false
        case "stop":
            controller.stop()
            visible = false
        case "ping":
            visible = controller.isVisible
        default:
            throw CursorOverlayError(message: "unknown cursor overlay operation")
        }
        var response: [String: Any] = ["ok": true, "op": command.operation, "visible": visible]
        if !visible && (command.operation == "show" || command.operation == "move"
            || command.operation == "press" || command.operation == "release"
            || command.operation == "validate") {
            response["reasonCode"] = reasonCode
            response["reason"] = reasonCode == "target-not-frontmost"
                ? "the bound target application is not frontmost; the agent cursor is hidden"
                : "the bound target window no longer matches; the agent cursor is hidden"
        }
        emitCursorResponse(response)
        completion()
    } catch let error as CursorOverlayError {
        emitCursorResponse(["ok": false, "error": error.message])
        completion()
    } catch {
        emitCursorResponse(["ok": false, "error": String(describing: error)])
        completion()
    }
}

private func cursorReasonCode(_ placement: CursorOverlayController.Placement) -> String? {
    switch placement {
    case .shown: return nil
    case .targetNotFrontmost: return "target-not-frontmost"
    case .targetUnavailable: return "target-invalid"
    }
}

private func cursorReason(_ placement: CursorOverlayController.Placement) -> String? {
    switch placement {
    case .shown: return nil
    case .targetNotFrontmost: return "the bound target application is not frontmost; the agent cursor is hidden"
    case .targetUnavailable: return "the bound target window no longer matches; the agent cursor is hidden"
    }
}

private func emitCursorResponse(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}
