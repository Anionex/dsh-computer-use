/** Coarse luminance comparison behind the reported pixel-only effect evidence. */
import type { BackendVisualSignature } from './backend.ts';
export interface VisualChange {
    /** Fraction of sampled cells that moved by at least `VISUAL_CHANGE_DELTA`. */
    ratio: number;
    /** True when `ratio` reaches `VISUAL_CHANGE_RATIO`. */
    changed: boolean;
}
/**
 * Compare the luminance grids sampled immediately before and after one action.
 *
 * Returns `undefined` when either side is missing or the grids are not
 * comparable, so a caller reports "not measured" instead of "no change". The
 * comparison proves that pixels moved, not that the action caused the movement:
 * a remote update, an animation, or another process can move them too.
 */
export declare function visualChange(before: BackendVisualSignature | undefined, after: BackendVisualSignature | undefined): VisualChange | undefined;
//# sourceMappingURL=visual.d.ts.map