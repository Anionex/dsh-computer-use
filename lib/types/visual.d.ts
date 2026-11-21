/** Compare coarse luminance samples of the same observed window. */
import type { BackendObservation } from './backend.ts';
/** Accept only a canonical sample of the exact app, window and frame size. */
export declare function readVisualSample(reference: BackendObservation, observation: BackendObservation): Buffer | undefined;
/** Test the sampled differences against the reporting threshold. */
export declare function hasVisualChange(before: Buffer, after: Buffer): boolean;
//# sourceMappingURL=visual.d.ts.map