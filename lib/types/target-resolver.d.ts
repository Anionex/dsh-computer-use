/** Provider-independent, fail-closed element target resolution. */
import type { BackendElement, BackendObservation } from './backend.ts';
import type { ComputerRect, ComputerTargetResolutionResult } from './types.ts';
/** Fixed confidence values used by the deterministic resolver. */
export declare const TARGET_RESOLUTION_CONFIDENCE: {
    readonly exactLocator: 1;
    readonly nativeIdentifier: 1;
    readonly semantic: 0.9;
    readonly semanticThreshold: 0.9;
};
interface AncestorFingerprintEntry {
    role: string;
    subrole?: string;
    accessibleName?: string;
}
/** Normalized provider evidence stored behind an opaque target handle. */
export interface ComputerTargetDescriptor {
    locator: number[];
    nativeIdentifier?: string;
    role: string;
    subrole?: string;
    accessibleName?: string;
    ancestorFingerprint: AncestorFingerprintEntry[];
    normalizedFrame?: ComputerRect;
    availableActions: string[];
}
/** Successful resolution plus the fresh provider observation used for input. */
export interface ResolvedComputerTarget {
    element: BackendElement;
    observation: BackendObservation;
    resolution: ComputerTargetResolutionResult;
}
/** Build the normalized descriptor stored behind one opaque handle. */
export declare function describeComputerTarget(element: BackendElement, observation: BackendObservation): ComputerTargetDescriptor;
/** Resolve one descriptor against a fresh provider observation without guessing. */
export declare function resolveComputerTarget(original: BackendObservation, fresh: BackendObservation, expected: ComputerTargetDescriptor, allowRebind: boolean): ResolvedComputerTarget;
export {};
//# sourceMappingURL=target-resolver.d.ts.map