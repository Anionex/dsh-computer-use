import { describe, expect, it } from 'vitest'
import type { BackendElement, BackendObservation } from '../src/backend.ts'
import {
  TARGET_RESOLUTION_CONFIDENCE,
  describeComputerTarget,
  resolveComputerTarget,
} from '../src/target-resolver.ts'
import { backendObservation } from './helpers.ts'

function target(overrides: Partial<BackendElement> = {}): BackendElement {
  return {
    index: 1,
    locator: [0],
    role: 'AXButton',
    title: 'Apply',
    label: 'Apply fixture values',
    enabled: true,
    actions: ['AXPress'],
    frame: { x: 220, y: 320, width: 80, height: 28 },
    ...overrides,
  }
}

function observation(elements: BackendElement[], overrides: Partial<BackendObservation> = {}): BackendObservation {
  return backendObservation({ elements, ...overrides })
}

describe('provider-independent target resolver', () => {
  it('uses the original locator when stable identity is unchanged', () => {
    const original = observation([target({ index: 0, locator: [] })])
    const fresh = observation([target({ index: 0, locator: [], enabled: false })], { stateHash: 'state-2' })
    const descriptor = describeComputerTarget(original.elements[0]!, original)

    expect(resolveComputerTarget(original, fresh, descriptor, false)).toMatchObject({
      element: { index: 0 },
      resolution: {
        mode: 'exact-locator',
        confidence: 1,
        candidateCount: 1,
        targetChanged: false,
      },
    })
  })

  it('prefers a unique provider-native identifier after locator reordering', () => {
    const original = observation([target({ index: 0, locator: [0], nativeIdentifier: 'fixture.apply' })])
    const fresh = observation([
      target({ index: 0, locator: [0], title: 'Unrelated', label: 'Unrelated', nativeIdentifier: 'fixture.unrelated' }),
      target({ index: 1, locator: [1], nativeIdentifier: 'fixture.apply' }),
    ], { stateHash: 'state-2' })

    expect(resolveComputerTarget(original, fresh, describeComputerTarget(original.elements[0]!, original), true)).toMatchObject({
      element: { index: 1, locator: [1] },
      resolution: {
        mode: 'native-identifier',
        confidence: 1,
        candidateCount: 1,
        targetChanged: true,
      },
    })
  })

  it('does not downgrade exact identity when a native identifier disappears', () => {
    const originalTarget = target({ index: 0, locator: [0], nativeIdentifier: 'fixture.apply' })
    const original = observation([originalTarget])
    const fresh = observation([
      target({ index: 0, locator: [0] }),
      target({ index: 1, locator: [1], nativeIdentifier: 'fixture.apply' }),
    ], { stateHash: 'state-2' })

    expect(resolveComputerTarget(original, fresh, describeComputerTarget(originalTarget, original), true)).toMatchObject({
      element: { index: 1, locator: [1] },
      resolution: { mode: 'native-identifier', candidateCount: 1, targetChanged: true },
    })
    expect(() => resolveComputerTarget(original, fresh, describeComputerTarget(originalTarget, original), false))
      .toThrow(expect.objectContaining({ code: 'COMPUTER_STALE_OBSERVATION' }))
  })

  it('uses a unique semantic match after an unrelated sibling shifts the locator', () => {
    const root = target({ index: 0, locator: [], role: 'AXWindow', title: 'Fixture', label: 'Fixture', actions: [] })
    const originalTarget = target({ index: 1, locator: [0] })
    const original = observation([root, originalTarget])
    const fresh = observation([
      root,
      target({ index: 1, locator: [0], title: 'Unrelated', label: 'Unrelated', actions: [] }),
      target({ index: 2, locator: [1] }),
    ], { stateHash: 'state-2' })

    expect(resolveComputerTarget(original, fresh, describeComputerTarget(originalTarget, original), true)).toMatchObject({
      element: { index: 2, locator: [1] },
      resolution: {
        mode: 'semantic-rebind',
        confidence: TARGET_RESOLUTION_CONFIDENCE.semantic,
        candidateCount: 1,
        targetChanged: true,
      },
    })
  })

  it('fails as ambiguous for duplicate labels under the same ancestor', () => {
    const root = target({ index: 0, locator: [], role: 'AXWindow', title: 'Fixture', label: 'Fixture', actions: [] })
    const originalTarget = target({ index: 1, locator: [0] })
    const original = observation([root, originalTarget])
    const fresh = observation([
      root,
      target({ index: 1, locator: [1] }),
      target({ index: 2, locator: [2] }),
    ], { stateHash: 'state-2' })

    expect(() => resolveComputerTarget(original, fresh, describeComputerTarget(originalTarget, original), true))
      .toThrow(expect.objectContaining({ code: 'COMPUTER_TARGET_AMBIGUOUS' }))
  })

  it('uses a stable ancestor fingerprint to distinguish duplicate labels', () => {
    const root = target({ index: 0, locator: [], role: 'AXWindow', title: 'Fixture', label: 'Fixture', actions: [] })
    const primary = target({ index: 1, locator: [0], role: 'AXGroup', title: 'Primary', label: 'Primary', actions: [] })
    const originalTarget = target({ index: 2, locator: [0, 0] })
    const original = observation([root, primary, originalTarget])
    const fresh = observation([
      root,
      target({ index: 1, locator: [0], role: 'AXStaticText', title: 'Unrelated', label: 'Unrelated', actions: [] }),
      target({ index: 2, locator: [1], role: 'AXGroup', title: 'Primary', label: 'Primary', actions: [] }),
      target({ index: 3, locator: [1, 0] }),
      target({ index: 4, locator: [2], role: 'AXGroup', title: 'Secondary', label: 'Secondary', actions: [] }),
      target({ index: 5, locator: [2, 0] }),
    ], { stateHash: 'state-2' })

    expect(resolveComputerTarget(original, fresh, describeComputerTarget(originalTarget, original), true)).toMatchObject({
      element: { index: 3 },
      resolution: { mode: 'semantic-rebind', candidateCount: 1, targetChanged: true },
    })
  })

  it('does not mistake a same-label replacement at the old locator for the original target', () => {
    const root = target({ index: 0, locator: [], role: 'AXWindow', title: 'Fixture', label: 'Fixture', actions: [] })
    const originalTarget = target({ index: 1, locator: [0] })
    const original = observation([root, originalTarget])
    const fresh = observation([
      root,
      target({ index: 1, locator: [0], frame: { x: 420, y: 320, width: 80, height: 28 } }),
      target({ index: 2, locator: [1] }),
    ], { stateHash: 'state-2' })

    expect(() => resolveComputerTarget(original, fresh, describeComputerTarget(originalTarget, original), true))
      .toThrow(expect.objectContaining({ code: 'COMPUTER_TARGET_AMBIGUOUS' }))
  })

  it('uses a stable named ancestor to distinguish duplicate labels after subtree recycling', () => {
    const root = target({ index: 0, locator: [], role: 'AXWindow', title: 'Fixture', label: 'Fixture', actions: [] })
    const primary = target({ index: 1, locator: [0], role: 'AXGroup', title: 'Primary list', label: 'Primary list', actions: [], frame: undefined })
    const originalTarget = target({ index: 2, locator: [0, 0], title: 'Open', label: 'Open', frame: { x: 220, y: 320, width: 80, height: 28 } })
    const original = observation([root, primary, originalTarget])
    const secondary = target({ index: 1, locator: [0], role: 'AXGroup', title: 'Secondary list', label: 'Secondary list', actions: [], frame: undefined })
    const secondaryTarget = target({ index: 2, locator: [0, 0], title: 'Open', label: 'Open', frame: { x: 420, y: 320, width: 80, height: 28 } })
    const movedPrimary = { ...primary, index: 3, locator: [1] }
    const recycledTarget = { ...originalTarget, index: 4, locator: [1, 0] }
    const fresh = observation([root, secondary, secondaryTarget, movedPrimary, recycledTarget], { stateHash: 'state-2' })

    expect(resolveComputerTarget(original, fresh, describeComputerTarget(originalTarget, original), true)).toMatchObject({
      element: { index: 4, locator: [1, 0] },
      resolution: { mode: 'semantic-rebind', candidateCount: 1, targetChanged: true },
    })
  })

  it('fails with low confidence when semantic uniqueness cannot be established', () => {
    const originalTarget = target({ index: 0, locator: [], title: undefined, label: undefined })
    const original = observation([originalTarget])
    const fresh = observation([
      target({ index: 0, locator: [], role: 'AXStaticText', title: 'Unrelated', label: 'Unrelated', actions: [] }),
      target({ index: 1, locator: [0], title: undefined, label: undefined }),
    ], { stateHash: 'state-2' })

    expect(() => resolveComputerTarget(original, fresh, describeComputerTarget(originalTarget, original), true))
      .toThrow(expect.objectContaining({ code: 'COMPUTER_TARGET_LOW_CONFIDENCE' }))
  })

  it('does not claim unique native or semantic identity from a truncated fresh tree', () => {
    const originalTarget = target({ index: 0, locator: [0], nativeIdentifier: 'fixture.apply' })
    const original = observation([originalTarget])
    const fresh = observation([
      target({ index: 0, locator: [0], title: 'Unrelated', label: 'Unrelated', nativeIdentifier: 'fixture.unrelated' }),
      target({ index: 1, locator: [1], nativeIdentifier: 'fixture.apply' }),
    ], { stateHash: 'state-2', truncated: true })

    expect(() => resolveComputerTarget(original, fresh, describeComputerTarget(originalTarget, original), true))
      .toThrow(expect.objectContaining({ code: 'COMPUTER_TARGET_LOW_CONFIDENCE' }))
  })

  it('rejects process and selected-window changes before candidate matching', () => {
    const original = observation([target({ index: 0, locator: [] })])
    const descriptor = describeComputerTarget(original.elements[0]!, original)
    const wrongProcess = observation([target({ index: 0, locator: [] })], {
      app: { ...original.app, pid: original.app.pid + 1 },
    })
    const wrongWindow = observation([target({ index: 0, locator: [] })], {
      window: { ...original.window!, id: original.window!.id! + 1 },
    })

    expect(() => resolveComputerTarget(original, wrongProcess, descriptor, true))
      .toThrow(expect.objectContaining({ code: 'COMPUTER_STALE_OBSERVATION' }))
    expect(() => resolveComputerTarget(original, wrongWindow, descriptor, true))
      .toThrow(expect.objectContaining({ code: 'COMPUTER_STALE_OBSERVATION' }))
  })

  it('does not fingerprint secure or ordinary values', () => {
    const secure = target({ index: 0, locator: [], role: 'AXSecureTextField', value: '[secure]' })
    const descriptor = describeComputerTarget(secure, observation([secure]))
    expect(descriptor).not.toHaveProperty('value')
    expect(JSON.stringify(descriptor)).not.toContain('[secure]')
  })
})
