/** Compare coarse luminance samples of the same observed window. */

import type { BackendObservation } from './backend.ts'

const GRID_SIDE = 32
const GRID_CELLS = GRID_SIDE * GRID_SIDE
const MIN_CHANGED_CELLS = Math.ceil(GRID_CELLS * 0.02)
const MIN_LUMINANCE_DELTA = 16

/** Accept only a canonical sample of the exact app, window and frame size. */
export function readVisualSample(reference: BackendObservation, observation: BackendObservation): Buffer | undefined {
  if (reference.app.bundleId !== observation.app.bundleId || reference.app.pid !== observation.app.pid) return undefined
  const expected = reference.window
  const actual = observation.window
  if (expected?.id === undefined || !Number.isSafeInteger(expected.id) || expected.id <= 0
    || actual?.id !== expected.id) return undefined
  const { width, height } = expected.frame
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0
    || actual.frame.width !== width || actual.frame.height !== height) return undefined

  const signature = observation.visualSignature
  if (signature?.side !== GRID_SIDE || typeof signature.bytes !== 'string'
    || signature.bytes.length !== Math.ceil(GRID_CELLS / 3) * 4) return undefined
  const samples = Buffer.from(signature.bytes, 'base64')
  if (samples.length !== GRID_CELLS || samples.toString('base64') !== signature.bytes) return undefined
  return samples
}

/** Test the sampled differences against the reporting threshold. */
export function hasVisualChange(before: Buffer, after: Buffer): boolean {
  let changedCells = 0
  for (let index = 0; index < GRID_CELLS; index += 1) {
    if (Math.abs(before.readUInt8(index) - after.readUInt8(index)) >= MIN_LUMINANCE_DELTA) {
      changedCells += 1
      if (changedCells >= MIN_CHANGED_CELLS) return true
    }
  }
  return false
}
