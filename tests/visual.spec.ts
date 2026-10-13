import { describe, expect, it } from 'vitest'
import type { BackendVisualSignature } from '../src/backend.ts'
import { visualChange } from '../src/visual.ts'
import { visualSignatureGrid } from './helpers.ts'

/** Uniform black grid with the first `moved` cells at full luminance. */
function gridWithMovedCells(moved: number, side = 4): BackendVisualSignature {
  const samples = Array.from({ length: side * side }, (_, index) => (index < moved ? 255 : 0))
  return { side, bytes: Buffer.from(samples).toString('base64') }
}

describe('visualChange', () => {
  it('reports no change for identical grids', () => {
    expect(visualChange(visualSignatureGrid(120), visualSignatureGrid(120))).toEqual({ ratio: 0, changed: false })
  })

  it('reports a change once enough cells move', () => {
    expect(visualChange(visualSignatureGrid(0), gridWithMovedCells(1))).toEqual({ ratio: 1 / 16, changed: true })
  })

  it('ignores movement below the per-sample delta', () => {
    expect(visualChange(visualSignatureGrid(100), visualSignatureGrid(115))).toEqual({ ratio: 0, changed: false })
  })

  it('ignores movement that stays under the reporting ratio', () => {
    const side = 16
    // Five of 256 cells is 1.95%, just under the 2% reporting ratio.
    const result = visualChange(visualSignatureGrid(0, side), gridWithMovedCells(5, side))
    expect(result?.changed).toBe(false)
    expect(result?.ratio).toBeCloseTo(5 / 256)
  })

  it('reports not-measured instead of no-change when a side is missing', () => {
    expect(visualChange(undefined, visualSignatureGrid(1))).toBeUndefined()
    expect(visualChange(visualSignatureGrid(1), undefined)).toBeUndefined()
    expect(visualChange(undefined, undefined)).toBeUndefined()
  })

  it('refuses grids that are not comparable', () => {
    expect(visualChange(visualSignatureGrid(1, 4), visualSignatureGrid(1, 8))).toBeUndefined()
    expect(visualChange({ side: 0, bytes: '' }, { side: 0, bytes: '' })).toBeUndefined()
    expect(visualChange({ side: 4, bytes: 'AA==' }, visualSignatureGrid(1))).toBeUndefined()
  })
})
