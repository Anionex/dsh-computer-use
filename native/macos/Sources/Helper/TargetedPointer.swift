import CoreGraphics
import Darwin
import Foundation

struct TargetedPointerError: Error {
    let message: String
}

struct TargetedPointerTarget {
    let pid: pid_t
    let windowNumber: Int64
    let windowFrame: CGRect

    func localPoint(for screenPoint: CGPoint) -> CGPoint {
        CGPoint(
            x: screenPoint.x - windowFrame.origin.x,
            y: screenPoint.y - windowFrame.origin.y
        )
    }
}

private typealias PostToPidFunction = @convention(c) (pid_t, UnsafeMutableRawPointer?) -> Void
private typealias SetIntegerFieldFunction = @convention(c) (UnsafeMutableRawPointer?, UInt32, Int64) -> Void
private typealias SetWindowLocationFunction = @convention(c) (UnsafeMutableRawPointer?, Double, Double) -> Void

private final class SkyLightPointerBridge {
    static let shared = SkyLightPointerBridge()

    private let handle: UnsafeMutableRawPointer?
    private let postToPid: PostToPidFunction?
    private let setIntegerField: SetIntegerFieldFunction?
    private let setWindowLocation: SetWindowLocationFunction?

    private init() {
        handle = dlopen(
            "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
            RTLD_LAZY | RTLD_GLOBAL
        )
        postToPid = Self.resolve(handle, "SLEventPostToPid", as: PostToPidFunction.self)
        setIntegerField = Self.resolve(handle, "SLEventSetIntegerValueField", as: SetIntegerFieldFunction.self)
        setWindowLocation = Self.resolve(handle, "CGEventSetWindowLocation", as: SetWindowLocationFunction.self)
    }

    deinit {
        if let handle { dlclose(handle) }
    }

    private static func resolve<T>(_ handle: UnsafeMutableRawPointer?, _ name: String, as type: T.Type) -> T? {
        guard let handle, let symbol = dlsym(handle, name) else { return nil }
        return unsafeBitCast(symbol, to: type)
    }

    var isAvailable: Bool {
        postToPid != nil && setIntegerField != nil && setWindowLocation != nil
    }

    func post(
        _ event: CGEvent,
        target: TargetedPointerTarget,
        localPoint: CGPoint,
        clickState: Int64,
        buttonNumber: Int64,
        subtype: Int64,
        gesturePhase: Int64,
        clickGroup: Int64
    ) throws {
        guard let postToPid, let setIntegerField, let setWindowLocation else {
            throw TargetedPointerError(message: "SkyLight target-process pointer routing is unavailable")
        }
        let pointer = Unmanaged.passUnretained(event).toOpaque()
        setWindowLocation(pointer, localPoint.x, localPoint.y)
        setIntegerField(pointer, 0, gesturePhase)
        setIntegerField(pointer, 1, clickState)
        setIntegerField(pointer, 3, buttonNumber)
        setIntegerField(pointer, 7, subtype)
        setIntegerField(pointer, 40, Int64(target.pid))
        setIntegerField(pointer, 51, target.windowNumber)
        setIntegerField(pointer, 58, clickGroup)
        setIntegerField(pointer, 91, target.windowNumber)
        setIntegerField(pointer, 92, target.windowNumber)

        postToPid(target.pid, pointer)
    }
}

private func targetedPointerSource() throws -> CGEventSource {
    guard SkyLightPointerBridge.shared.isAvailable else {
        throw TargetedPointerError(message: "SkyLight target-process pointer routing is unavailable")
    }
    guard let source = CGEventSource(stateID: .privateState) else {
        throw TargetedPointerError(message: "CoreGraphics pointer event source is unavailable")
    }
    return source
}

private func clickGroup() -> Int64 {
    Int64(DispatchTime.now().uptimeNanoseconds & 0x7fff_ffff)
}

private func buttonNumber(_ button: CGMouseButton) -> Int64 {
    switch button {
    case .right: return 1
    case .center: return 2
    default: return 0
    }
}

private func pointerEvent(
    source: CGEventSource,
    type: CGEventType,
    button: CGMouseButton
) throws -> CGEvent {
    let cursorLocation = CGEvent(source: nil)?.location ?? .zero
    guard let event = CGEvent(
        mouseEventSource: source,
        mouseType: type,
        mouseCursorPosition: cursorLocation,
        mouseButton: button
    ) else {
        throw TargetedPointerError(message: "CoreGraphics could not create a pointer event")
    }
    return event
}

private func postPointerEvent(
    _ event: CGEvent,
    target: TargetedPointerTarget,
    point: CGPoint,
    clickState: Int64,
    buttonNumber: Int64,
    subtype: Int64,
    gesturePhase: Int64,
    clickGroup: Int64
) throws {
    try SkyLightPointerBridge.shared.post(
        event,
        target: target,
        localPoint: target.localPoint(for: point),
        clickState: clickState,
        buttonNumber: buttonNumber,
        subtype: subtype,
        gesturePhase: gesturePhase,
        clickGroup: clickGroup
    )
}

func targetedClick(
    at point: CGPoint,
    button: CGMouseButton,
    count: Int,
    target: TargetedPointerTarget
) throws {
    let source = try targetedPointerSource()
    let group = clickGroup()
    let number = buttonNumber(button)
    let moved = try pointerEvent(source: source, type: .mouseMoved, button: .left)
    try postPointerEvent(
        moved,
        target: target,
        point: point,
        clickState: 0,
        buttonNumber: 0,
        subtype: 3,
        gesturePhase: 2,
        clickGroup: group
    )
    usleep(12_000)

    let downType: CGEventType = button == .right ? .rightMouseDown : button == .center ? .otherMouseDown : .leftMouseDown
    let upType: CGEventType = button == .right ? .rightMouseUp : button == .center ? .otherMouseUp : .leftMouseUp
    for pair in 1...max(1, count) {
        let down = try pointerEvent(source: source, type: downType, button: button)
        down.setDoubleValueField(.mouseEventPressure, value: 1)
        try postPointerEvent(
            down,
            target: target,
            point: point,
            clickState: Int64(pair),
            buttonNumber: number,
            subtype: 3,
            gesturePhase: 3,
            clickGroup: group
        )
        usleep(28_000)

        let up = try pointerEvent(source: source, type: upType, button: button)
        up.setDoubleValueField(.mouseEventPressure, value: 0)
        try postPointerEvent(
            up,
            target: target,
            point: point,
            clickState: Int64(pair),
            buttonNumber: number,
            subtype: 3,
            gesturePhase: 3,
            clickGroup: group
        )
        if pair < count { usleep(80_000) }
    }
}

func targetedScroll(
    at point: CGPoint,
    vertical: Int32,
    horizontal: Int32,
    target: TargetedPointerTarget
) throws {
    let source = try targetedPointerSource()
    let group = clickGroup()
    let moved = try pointerEvent(source: source, type: .mouseMoved, button: .left)
    try postPointerEvent(
        moved,
        target: target,
        point: point,
        clickState: 0,
        buttonNumber: 0,
        subtype: 0,
        gesturePhase: 2,
        clickGroup: group
    )
    usleep(12_000)

    guard let event = CGEvent(
        scrollWheelEvent2Source: source,
        units: .line,
        wheelCount: 2,
        wheel1: vertical,
        wheel2: horizontal,
        wheel3: 0
    ) else {
        throw TargetedPointerError(message: "CoreGraphics could not create a scroll event")
    }
    event.location = CGEvent(source: nil)?.location ?? .zero
    try postPointerEvent(
        event,
        target: target,
        point: point,
        clickState: 0,
        buttonNumber: 0,
        subtype: 0,
        gesturePhase: 2,
        clickGroup: group
    )
}

func targetedDrag(
    from: CGPoint,
    to: CGPoint,
    target: TargetedPointerTarget
) throws {
    let source = try targetedPointerSource()
    let group = clickGroup()
    let moved = try pointerEvent(source: source, type: .mouseMoved, button: .left)
    try postPointerEvent(
        moved,
        target: target,
        point: from,
        clickState: 0,
        buttonNumber: 0,
        subtype: 0,
        gesturePhase: 2,
        clickGroup: group
    )
    usleep(12_000)

    let down = try pointerEvent(source: source, type: .leftMouseDown, button: .left)
    down.setDoubleValueField(.mouseEventPressure, value: 1)
    try postPointerEvent(
        down,
        target: target,
        point: from,
        clickState: 1,
        buttonNumber: 0,
        subtype: 0,
        gesturePhase: 3,
        clickGroup: group
    )
    usleep(16_000)

    for step in 1...12 {
        let fraction = CGFloat(step) / 12
        let point = CGPoint(
            x: from.x + (to.x - from.x) * fraction,
            y: from.y + (to.y - from.y) * fraction
        )
        let dragged = try pointerEvent(source: source, type: .leftMouseDragged, button: .left)
        dragged.setDoubleValueField(.mouseEventPressure, value: 1)
        try postPointerEvent(
            dragged,
            target: target,
            point: point,
            clickState: 1,
            buttonNumber: 0,
            subtype: 0,
            gesturePhase: 3,
            clickGroup: group
        )
        usleep(12_000)
    }
    usleep(50_000)

    let up = try pointerEvent(source: source, type: .leftMouseUp, button: .left)
    up.setDoubleValueField(.mouseEventPressure, value: 0)
    try postPointerEvent(
        up,
        target: target,
        point: to,
        clickState: 1,
        buttonNumber: 0,
        subtype: 0,
        gesturePhase: 3,
        clickGroup: group
    )
}
