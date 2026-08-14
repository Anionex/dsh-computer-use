import AppKit
import Foundation

private final class InputProbeView: NSView {
    var onEvent: ((String) -> Void)?
    private var dragging = false

    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        layer?.borderColor = NSColor.separatorColor.cgColor
        layer?.borderWidth = 1
        layer?.cornerRadius = 8
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Targeted pointer probe")
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        dragging = true
        onEvent?("pointer down")
    }

    override func mouseDragged(with event: NSEvent) {
        guard dragging else { return }
        onEvent?("pointer drag")
    }

    override func mouseUp(with event: NSEvent) {
        let wasDragging = dragging
        dragging = false
        onEvent?(wasDragging ? "pointer up" : "pointer up without down")
    }

    override func scrollWheel(with event: NSEvent) {
        onEvent?("pointer scroll")
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let text = "Targeted pointer probe"
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13, weight: .medium),
            .foregroundColor: NSColor.secondaryLabelColor,
        ]
        let size = text.size(withAttributes: attributes)
        text.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2), withAttributes: attributes)
    }
}

private final class FixtureDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var textField: NSTextField!
    private var secureField: NSSecureTextField!
    private var checkbox: NSButton!
    private var popup: NSPopUpButton!
    private var slider: NSSlider!
    private var statusLabel: NSTextField!
    private var inputProbe: InputProbeView!
    private var stack: NSStackView!
    private var insertedHarmlessSibling = false
    private var keyMonitor: Any?
    private var reorderTimer: Timer?
    private var pointerClickCount = 0
    private var pointerScrollCount = 0
    private var pointerDragCount = 0
    private var pointerMouseDownCount = 0
    private var pointerMouseUpCount = 0
    private var pointerDragGestureCount = 0
    private var activeDragGesture = false
    private var activationCount = 0
    private let transcriptPath: String?
    private let reorderTriggerPath: String?
    private let launchInBackground: Bool

    override init() {
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "--transcript"), arguments.indices.contains(index + 1) {
            transcriptPath = arguments[index + 1]
        } else {
            transcriptPath = nil
        }
        if let index = arguments.firstIndex(of: "--reorder-trigger"), arguments.indices.contains(index + 1) {
            reorderTriggerPath = arguments[index + 1]
        } else {
            reorderTriggerPath = nil
        }
        launchInBackground = arguments.contains("--background")
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 36 else { return event }
            self?.applyValues()
            return nil
        }
        if launchInBackground {
            window.orderFrontRegardless()
            window.orderBack(nil)
        } else {
            NSApplication.shared.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        }
        writeTranscript(event: "ready")
        if let reorderTriggerPath {
            reorderTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] timer in
                guard FileManager.default.fileExists(atPath: reorderTriggerPath) else { return }
                timer.invalidate()
                self?.insertHarmlessSibling()
            }
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        activationCount += 1
        writeTranscript(event: "activated")
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        reorderTimer?.invalidate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 560),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "DSH Computer Use Fixture"
        window.center()
        window.setFrameAutosaveName("dsh-computer-use-fixture")

        let content = NSView()
        content.translatesAutoresizingMaskIntoConstraints = false
        window.contentView = content

        let title = NSTextField(labelWithString: "Computer Use deterministic fixture")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        title.setAccessibilityLabel("Fixture title")

        textField = NSTextField(string: "initial text")
        textField.placeholderString = "Editable text"
        textField.setAccessibilityLabel("Editable text")
        textField.identifier = NSUserInterfaceItemIdentifier("fixture.text")
        textField.target = self
        textField.action = #selector(applyValues)

        secureField = NSSecureTextField(string: "fixture-secret")
        secureField.placeholderString = "Secure text"
        secureField.setAccessibilityLabel("Secure text")
        secureField.identifier = NSUserInterfaceItemIdentifier("fixture.secure")

        checkbox = makeCheckbox(state: .off)

        popup = NSPopUpButton(frame: .zero, pullsDown: false)
        popup.addItems(withTitles: ["Alpha", "Beta", "Gamma"])
        popup.selectItem(at: 0)
        popup.target = self
        popup.action = #selector(selectPopup)
        popup.setAccessibilityLabel("Fixture selection")

        slider = NSSlider(value: 25, minValue: 0, maxValue: 100, target: self, action: #selector(changeSlider))
        slider.setAccessibilityLabel("Fixture slider")

        let apply = NSButton(title: "Apply", target: self, action: #selector(applyValues))
        apply.bezelStyle = .rounded
        apply.keyEquivalent = "\r"
        apply.setAccessibilityLabel("Apply fixture values")

        let delayed = NSButton(title: "Delayed update", target: self, action: #selector(delayedUpdate))
        delayed.bezelStyle = .rounded
        delayed.setAccessibilityLabel("Start delayed update")

        let modal = NSButton(title: "Show modal", target: self, action: #selector(showModal))
        modal.bezelStyle = .rounded
        modal.setAccessibilityLabel("Show fixture modal")

        statusLabel = NSTextField(labelWithString: "Status: ready")
        statusLabel.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        statusLabel.setAccessibilityLabel("Fixture status")
        statusLabel.identifier = NSUserInterfaceItemIdentifier("fixture.status")

        inputProbe = InputProbeView(frame: .zero)
        inputProbe.translatesAutoresizingMaskIntoConstraints = false
        inputProbe.heightAnchor.constraint(equalToConstant: 54).isActive = true
        inputProbe.onEvent = { [weak self] event in
            guard let self else { return }
            switch event {
            case "pointer down":
                self.pointerMouseDownCount += 1
                self.activeDragGesture = false
                return
            case "pointer drag":
                self.pointerDragCount += 1
                self.activeDragGesture = true
                self.statusLabel.stringValue = "Status: pointer drag"
            case "pointer up":
                self.pointerMouseUpCount += 1
                if self.activeDragGesture {
                    self.pointerDragGestureCount += 1
                    self.statusLabel.stringValue = "Status: pointer drag"
                } else {
                    self.pointerClickCount += 1
                    self.statusLabel.stringValue = "Status: pointer click"
                }
                self.activeDragGesture = false
            case "pointer scroll":
                self.pointerScrollCount += 1
                self.statusLabel.stringValue = "Status: pointer scroll"
            default: break
            }
            self.writeTranscript(event: event)
        }

        let longText = (1...80).map { "Scrollable row \($0)" }.joined(separator: "\n")
        let textView = NSTextView()
        textView.string = longText
        textView.isEditable = false
        textView.isSelectable = true
        textView.setAccessibilityLabel("Scrollable fixture rows")
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.documentView = textView
        scroll.heightAnchor.constraint(equalToConstant: 180).isActive = true

        let fields = NSGridView(views: [
            [NSTextField(labelWithString: "Text"), textField],
            [NSTextField(labelWithString: "Secret"), secureField],
            [NSTextField(labelWithString: "Selection"), popup],
            [NSTextField(labelWithString: "Level"), slider],
        ])
        fields.rowSpacing = 10
        fields.columnSpacing = 14
        fields.column(at: 0).xPlacement = .trailing
        fields.column(at: 1).width = 460

        let buttons = NSStackView(views: [apply, delayed, modal])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        stack = NSStackView(views: [title, fields, checkbox, buttons, statusLabel, inputProbe, scroll])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -24),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            inputProbe.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        window.makeFirstResponder(textField)
    }

    @objc private func applyValues() {
        statusLabel.stringValue = "Status: applied \(textField.stringValue)"
        writeTranscript(event: "apply")
    }

    @objc private func toggleCheckbox() {
        statusLabel.stringValue = checkbox.state == .on ? "Status: option enabled" : "Status: option disabled"
        writeTranscript(event: "checkbox")
    }

    @objc private func selectPopup() {
        statusLabel.stringValue = "Status: selected \(popup.titleOfSelectedItem ?? "")"
        writeTranscript(event: "selection")
    }

    @objc private func changeSlider() {
        statusLabel.stringValue = "Status: slider \(Int(slider.doubleValue))"
        writeTranscript(event: "slider")
    }

    @objc private func delayedUpdate() {
        statusLabel.stringValue = "Status: waiting"
        writeTranscript(event: "delay-start")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.statusLabel.stringValue = "Status: delayed complete"
            self?.writeTranscript(event: "delay-complete")
        }
    }

    private func insertHarmlessSibling() {
        guard !insertedHarmlessSibling else { return }
        insertedHarmlessSibling = true
        let checkboxState = checkbox.state
        stack.removeArrangedSubview(checkbox)
        checkbox.removeFromSuperview()
        let label = NSTextField(labelWithString: "Harmless dynamic sibling")
        label.setAccessibilityLabel("Harmless dynamic sibling")
        label.identifier = NSUserInterfaceItemIdentifier("fixture.harmless-sibling")
        stack.insertArrangedSubview(label, at: 2)
        checkbox = makeCheckbox(state: checkboxState)
        stack.insertArrangedSubview(checkbox, at: 3)
        statusLabel.stringValue = "Status: harmless sibling inserted"
        writeTranscript(event: "reorder")
    }

    private func makeCheckbox(state: NSControl.StateValue) -> NSButton {
        let value = NSButton(checkboxWithTitle: "Enable deterministic option", target: self, action: #selector(toggleCheckbox))
        value.state = state
        value.setAccessibilityLabel("Enable deterministic option")
        value.identifier = NSUserInterfaceItemIdentifier("fixture.checkbox")
        return value
    }

    @objc private func showModal() {
        let alert = NSAlert()
        alert.messageText = "Fixture modal"
        alert.informativeText = "This modal exists for deterministic Accessibility observation."
        alert.addButton(withTitle: "Confirm")
        alert.beginSheetModal(for: window) { [weak self] _ in
            self?.statusLabel.stringValue = "Status: modal confirmed"
            self?.writeTranscript(event: "modal")
        }
    }

    private func writeTranscript(event: String) {
        guard let transcriptPath else { return }
        let payload: [String: Any] = [
            "event": event,
            "text": textField?.stringValue ?? "",
            "secureLength": secureField?.stringValue.count ?? 0,
            "checked": checkbox?.state == .on,
            "selection": popup?.titleOfSelectedItem ?? "",
            "slider": Int(slider?.doubleValue ?? 0),
            "status": statusLabel?.stringValue ?? "",
            "pointerClickCount": pointerClickCount,
            "pointerScrollCount": pointerScrollCount,
            "pointerDragCount": pointerDragCount,
            "pointerMouseDownCount": pointerMouseDownCount,
            "pointerMouseUpCount": pointerMouseUpCount,
            "pointerDragGestureCount": pointerDragGestureCount,
            "activationCount": activationCount,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
        try? data.write(to: URL(fileURLWithPath: transcriptPath), options: .atomic)
    }
}

let app = NSApplication.shared
private let delegate = FixtureDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
