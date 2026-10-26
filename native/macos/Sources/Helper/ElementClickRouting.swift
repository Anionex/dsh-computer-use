enum ElementClickRoute {
    case accessibility
    case pointer
    case unavailable
}

/// Select one input route before delivery. An AX success is terminal, even if
/// its effect is remote, delayed, or absent from the Accessibility tree.
func elementClickRoute(
    webContent: Bool,
    supportsManualAccessibility: Bool,
    allowCoordinateFallback: Bool,
    hasCoordinates: Bool,
    pointerInputAllowed: Bool,
    press: () -> Bool
) -> ElementClickRoute {
    if webContent && supportsManualAccessibility && allowCoordinateFallback && pointerInputAllowed {
        return .pointer
    }
    if press() { return .accessibility }
    return allowCoordinateFallback || hasCoordinates ? .pointer : .unavailable
}
