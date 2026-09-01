/** Non-macOS fallback backend: keeps the Service injectable, fails closed, and reports an unavailable health state. */
import type { BackendActionRequest, BackendActionResult, BackendCursorAction, BackendHealth, BackendObservation, BackendObserveOptions, ComputerUseBackend, CursorVisibility } from '../backend.ts';
import type { ComputerAppIdentity, ComputerAppSelector, ComputerAppSummary } from '../types.ts';
/** Backend that reports a clear unavailable state instead of failing profile startup on non-macOS hosts. */
export declare class UnsupportedPlatformBackend implements ComputerUseBackend {
    private readonly platform;
    readonly name: "unsupported";
    readonly helperPath = "";
    constructor(platform: NodeJS.Platform);
    health(): Promise<BackendHealth>;
    resolveApp(_selector: ComputerAppSelector): Promise<ComputerAppIdentity>;
    listApps(): Promise<ComputerAppSummary[]>;
    observe(_app: ComputerAppIdentity, _options: BackendObserveOptions): Promise<BackendObservation>;
    act(_request: BackendActionRequest): Promise<BackendActionResult>;
    visualizeCursor(_action: BackendCursorAction, _phase: 'before' | 'after'): Promise<CursorVisibility>;
    openSettings(_kind: 'accessibility' | 'screen-recording'): Promise<void>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=unsupported.d.ts.map