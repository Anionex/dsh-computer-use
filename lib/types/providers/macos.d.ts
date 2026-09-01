/** macOS Accessibility/CoreGraphics/ScreenCaptureKit provider for `ctx.computerUse`. */
import { Service, type Context } from '@deepseek-ai/cordis';
import type { BackendActionRequest, BackendActionResult, BackendCursorAction, BackendHealth, BackendObservation, BackendObserveOptions, ComputerUseBackend, CursorVisibility } from '../backend.ts';
import { type ComputerUseConfig, type ResolvedComputerUseConfig } from '../config.ts';
import { ComputerUseService } from '../service.ts';
import type { ComputerAppIdentity, ComputerAppSelector, ComputerAppSummary } from '../types.ts';
import { NativeHelperClient } from './native-helper.ts';
/** Fixed-command native backend. */
export declare class MacOSBackend implements ComputerUseBackend {
    private readonly config;
    readonly name: "macos-ax";
    readonly client: NativeHelperClient;
    constructor(ctx: Context, config: ResolvedComputerUseConfig);
    get helperPath(): string;
    resolveApp(selector: ComputerAppSelector, signal: AbortSignal): Promise<ComputerAppIdentity>;
    listApps(signal: AbortSignal): Promise<ComputerAppSummary[]>;
    observe(app: ComputerAppIdentity, options: BackendObserveOptions, signal: AbortSignal): Promise<BackendObservation>;
    act(request: BackendActionRequest, signal: AbortSignal): Promise<BackendActionResult>;
    visualizeCursor(action: BackendCursorAction, phase: 'before' | 'after', signal: AbortSignal): Promise<CursorVisibility>;
    dispose(): Promise<void>;
    health(signal: AbortSignal): Promise<BackendHealth>;
    openSettings(kind: 'accessibility' | 'screen-recording', signal: AbortSignal): Promise<void>;
}
/** Cordis Service provider loaded by the Bundle before the model-facing consumer. */
export declare class MacOSComputerUseProvider extends ComputerUseService {
    static inject: string[];
    static Config: import("@deepseek-ai/schemastery").default<ComputerUseConfig>;
    private readonly settings;
    constructor(ctx: Context, config?: ComputerUseConfig);
    /** Verify helper integrity and permissions before the service is injectable. */
    protected [Service.init](): Promise<void>;
}
export default MacOSComputerUseProvider;
//# sourceMappingURL=macos.d.ts.map