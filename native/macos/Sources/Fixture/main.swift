import AppKit
import Foundation

private final class FixtureDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var textField: NSTextField!
    private var secureField: NSSecureTextField!
    private var checkbox: NSButton!
    private var popup: NSPopUpButton!
    private var slider: NSSlider!
    private var statusLabel: NSTextField!
    private var keyMonitor: Any?
    private let transcriptPath: String?

    override init() {
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "--transcript"), arguments.indices.contains(index + 1) {
            transcriptPath = arguments[index + 1]
        } else {
            transcriptPath = nil
        }
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 36 else { return event }
            self?.applyValues()
            return nil
        }
        writeTranscript(event: "ready")
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
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

        checkbox = NSButton(checkboxWithTitle: "Enable deterministic option", target: self, action: #selector(toggleCheckbox))
        checkbox.state = .off
        checkbox.setAccessibilityLabel("Enable deterministic option")

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

        let stack = NSStackView(views: [title, fields, checkbox, buttons, statusLabel, scroll])
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
        ])
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
