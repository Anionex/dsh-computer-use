/** Non-macOS fallback backend: keeps the Service injectable, fails closed, and reports an unavailable health state. */
import { ComputerUseError } from "../errors.js";
function unsupported(platform) {
    return new ComputerUseError('COMPUTER_UNSUPPORTED_PLATFORM', `dsh-computer-use supports macOS only; Computer Use is disabled on ${platform}`);
}
/** Backend that reports a clear unavailable state instead of failing profile startup on non-macOS hosts. */
export class UnsupportedPlatformBackend {
    platform;
    name = 'unsupported';
    helperPath = '';
    constructor(platform) {
        this.platform = platform;
    }
    async health() {
        const failure = unsupported(this.platform);
        return {
            ready: false,
            error: failure.message,
            helperVersion: 'unsupported',
            helperSha256: '',
            accessibility: 'unavailable',
            screenRecording: 'unavailable',
        };
    }
    resolveApp(_selector) {
        return Promise.reject(unsupported(this.platform));
    }
    listApps() {
        return Promise.reject(unsupported(this.platform));
    }
    observe(_app, _options) {
        return Promise.reject(unsupported(this.platform));
    }
    act(_request) {
        return Promise.reject(unsupported(this.platform));
    }
    visualizeCursor(_action, _phase) {
        return Promise.reject(unsupported(this.platform));
    }
    openSettings(_kind) {
        return Promise.reject(unsupported(this.platform));
    }
    async dispose() { }
}
//# sourceMappingURL=unsupported.js.map