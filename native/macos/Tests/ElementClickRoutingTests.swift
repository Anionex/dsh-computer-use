@main
struct ElementClickRoutingTests {
    static func main() {
        // These callbacks are counters only: no AppKit, AX, windows, or input.
        let cases: [(Bool, Bool, Bool, Bool, Bool, Bool, ElementClickRoute, Int)] = [
            // Electron web content: opt-in selects pointer before any AX press.
            (true, true, true, false, true, true, .pointer, 0),
            // Default and denied-pointer routes preserve successful semantics.
            (true, true, false, false, true, true, .accessibility, 1),
            (true, true, false, false, false, true, .accessibility, 1),
            // WebKit-like content does not inherit Electron's workaround.
            (true, false, true, false, true, true, .accessibility, 1),
            (true, false, false, false, false, true, .accessibility, 1),
            // A native control's AX success cannot trigger a duplicate input,
            // even when the app also has web content and the UI never changes.
            (false, true, true, false, true, true, .accessibility, 1),
            // Actual AX rejection retains the existing opt-in fallback.
            (false, false, true, false, true, false, .pointer, 1),
            (false, false, false, true, true, false, .pointer, 1),
            (false, false, false, false, true, false, .unavailable, 1),
        ]
        for (web, manual, fallback, coordinates, allowed, success, expected, expectedPresses) in cases {
            var presses = 0
            let route = elementClickRoute(
                webContent: web, supportsManualAccessibility: manual,
                allowCoordinateFallback: fallback, hasCoordinates: coordinates,
                pointerInputAllowed: allowed,
                press: { presses += 1; return success }
            )
            precondition(route == expected)
            precondition(presses == expectedPresses)
            let pointerDeliveries = route == .pointer ? 1 : 0
            precondition((success ? presses : 0) + pointerDeliveries <= 1)
        }
        print("PASS ElementClickRoutingTests (9 cases; no desktop access)")
    }
}
