/** Coarse luminance comparison behind the reported pixel-only effect evidence. */
/**
 * Fraction of the sampled grid that must move before the Service reports a
 * visual change. At the provider's 32x32 grid this is about 21 samples: a
 * ticking clock, a caret, or a progress shimmer stays below it, while a dialog,
 * a menu, a page switch, or a layout change crosses it.
 */
const VISUAL_CHANGE_RATIO = 0.02;
/** Per-sample luminance delta, out of 255, that counts as one moved sample. */
const VISUAL_CHANGE_DELTA = 16;
/**
 * Compare the luminance grids sampled immediately before and after one action.
 *
 * Returns `undefined` when either side is missing or the grids are not
 * comparable, so a caller reports "not measured" instead of "no change". The
 * comparison proves that pixels moved, not that the action caused the movement:
 * a remote update, an animation, or another process can move them too.
 */
export function visualChange(before, after) {
    if (before === undefined || after === undefined)
        return undefined;
    if (!Number.isInteger(before.side) || before.side <= 0 || before.side !== after.side)
        return undefined;
    const cells = before.side * before.side;
    const left = Buffer.from(before.bytes, 'base64');
    const right = Buffer.from(after.bytes, 'base64');
    if (left.length < cells || right.length < cells)
        return undefined;
    let moved = 0;
    for (let index = 0; index < cells; index += 1) {
        if (Math.abs((left[index] ?? 0) - (right[index] ?? 0)) >= VISUAL_CHANGE_DELTA)
            moved += 1;
    }
    const ratio = moved / cells;
    return { ratio, changed: ratio >= VISUAL_CHANGE_RATIO };
}
//# sourceMappingURL=visual.js.map