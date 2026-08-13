/** macOS Accessibility/CoreGraphics/ScreenCaptureKit provider for `ctx.computerUse`. */
import { Service, type Context } from '@deepseek-ai/cordis';
import { type ComputerUseConfig } from '../config.ts';
import { ComputerUseService } from '../service.ts';
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