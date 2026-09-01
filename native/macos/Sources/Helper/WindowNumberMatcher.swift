struct WindowNumberCandidate {
    let number: Int?
    let title: String?
}

private func titlesMatch(_ observed: String, _ candidate: String) -> Bool {
    if observed == candidate { return true }
    let (shorter, longer) = observed.count < candidate.count
        ? (observed, candidate)
        : (candidate, observed)
    guard longer.hasPrefix(shorter), let boundary = longer.dropFirst(shorter.count).first else { return false }
    return boundary.isWhitespace || "-–—:|([{·".contains(boundary)
}

func matchedWindowNumber(
    candidates: [WindowNumberCandidate],
    observedTitle: String?
) -> Int? {
    if candidates.count == 1 {
        return candidates[0].number
    }
    guard let observedTitle, !observedTitle.isEmpty else { return nil }
    let titled = candidates.filter { candidate in
        guard let candidateTitle = candidate.title, !candidateTitle.isEmpty else { return false }
        return titlesMatch(observedTitle, candidateTitle)
    }
    guard titled.count == 1 else { return nil }
    return titled[0].number
}
