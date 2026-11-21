import { describe, expect, it } from 'vitest'
import { hasVisualChange, readVisualSample } from '../src/visual.ts'
import { backendObservation, visualSignature } from './helpers.ts'

describe('visual samples', () => {
  it('requires a luminance delta of 16 in at least 21 of 1024 cells', () => {
    const before = Buffer.alloc(32 * 32)
    const samples = (changed: number, luminance: number) =>
      Buffer.from(visualSignature(changed, luminance).bytes, 'base64')
    expect(hasVisualChange(before, samples(20, 255))).toBe(false)
    expect(hasVisualChange(before, samples(32 * 32, 15))).toBe(false)
    expect(hasVisualChange(before, samples(21, 16))).toBe(true)
    expect(hasVisualChange(samples(21, 16), before)).toBe(true)
  })

  it('compares signatures only for the same application, process, window, and dimensions', () => {
    const reference = backendObservation()
    const observation = backendObservation({ visualSignature: visualSignature() })
    const window = observation.window!
    expect(readVisualSample(reference, observation)).toEqual(Buffer.alloc(32 * 32))
    expect(readVisualSample(reference, { ...observation, app: { ...observation.app, bundleId: 'another-app' } })).toBeUndefined()
    expect(readVisualSample(reference, { ...observation, app: { ...observation.app, pid: observation.app.pid + 1 } })).toBeUndefined()
    expect(readVisualSample(reference, { ...observation, window: { ...window, id: window.id! + 1 } })).toBeUndefined()
    expect(readVisualSample(reference, {
      ...observation,
      window: { ...window, frame: { ...window.frame, width: window.frame.width + 1 } },
    })).toBeUndefined()
    expect(readVisualSample(reference, {
      ...observation,
      window: { ...window, frame: { ...window.frame, height: window.frame.height + 1 } },
    })).toBeUndefined()
  })

  it('rejects absent and malformed signatures', () => {
    const reference = backendObservation()
    const signature = visualSignature()
    expect(readVisualSample(reference, reference)).toBeUndefined()
    for (const invalid of [
      { ...signature, side: 16 },
      { ...signature, bytes: 'AA==' },
      { ...signature, bytes: Buffer.alloc(1025).toString('base64') },
      { ...signature, bytes: signature.bytes.replace(/A==$/, 'B==') },
    ]) {
      expect(readVisualSample(reference, backendObservation({ visualSignature: invalid }))).toBeUndefined()
    }
  })
})
