import Darwin
import Foundation

@main
private enum WindowNumberMatcherTests {
    private static func expectEqual(_ actual: Int?, _ expected: Int?, _ name: String) {
        guard actual == expected else {
            FileHandle.standardError.write(Data("FAIL \(name): expected \(String(describing: expected)), got \(String(describing: actual))\n".utf8))
            Darwin.exit(1)
        }
    }

    static func main() {
        expectEqual(
            matchedWindowNumber(
                candidates: [WindowNumberCandidate(number: 101, title: "WindowServer title")],
                observedTitle: "Different accessibility title"
            ),
            101,
            "unique owner-frame candidate ignores title mismatch"
        )

        expectEqual(
            matchedWindowNumber(
                candidates: [
                    WindowNumberCandidate(number: 201, title: "备忘录"),
                    WindowNumberCandidate(number: 202, title: "Preferences"),
                ],
                observedTitle: "备忘录 – 5个备忘录"
            ),
            201,
            "multiple candidates select one non-empty prefix"
        )

        expectEqual(
            matchedWindowNumber(
                candidates: [
                    WindowNumberCandidate(number: 301, title: ""),
                    WindowNumberCandidate(number: 302, title: "备忘录"),
                ],
                observedTitle: "备忘录 – 5个备忘录"
            ),
            302,
            "empty candidate title does not participate"
        )

        expectEqual(
            matchedWindowNumber(
                candidates: [
                    WindowNumberCandidate(number: 401, title: "备忘录"),
                    WindowNumberCandidate(number: 402, title: "备忘录 – 5个备忘录"),
                    WindowNumberCandidate(number: 403, title: ""),
                ],
                observedTitle: "备忘录 – 5个备忘录"
            ),
            nil,
            "multiple candidates without a unique title match fail closed"
        )

        expectEqual(
            matchedWindowNumber(
                candidates: [
                    WindowNumberCandidate(number: 501, title: "Document"),
                    WindowNumberCandidate(number: 502, title: "Preferences"),
                ],
                observedTitle: "Doc"
            ),
            nil,
            "plain lexical prefix is not window identity evidence"
        )

        print("PASS WindowNumberMatcherTests (5 cases)")
    }
}
