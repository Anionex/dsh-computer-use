/** Provider-independent, fail-closed element target resolution. */

import type { BackendElement, BackendObservation } from './backend.ts'
import { ComputerUseError } from './errors.ts'
import type { ComputerRect, ComputerTargetResolutionResult } from './types.ts'

/** Fixed confidence values used by the deterministic resolver. */
export const TARGET_RESOLUTION_CONFIDENCE = {
  exactLocator: 1,
  nativeIdentifier: 1,
  semantic: 0.9,
  semanticThreshold: 0.9,
} as const

interface AncestorFingerprintEntry {
  role: string
  subrole?: string
  accessibleName?: string
}

/** Normalized provider evidence stored behind an opaque target handle. */
export interface ComputerTargetDescriptor {
  locator: number[]
  nativeIdentifier?: string
  role: string
  subrole?: string
  accessibleName?: string
  ancestorFingerprint: AncestorFingerprintEntry[]
  normalizedFrame?: ComputerRect
  availableActions: string[]
}

/** Successful resolution plus the fresh provider observation used for input. */
export interface ResolvedComputerTarget {
  element: BackendElement
  observation: BackendObservation
  resolution: ComputerTargetResolutionResult
}

function normalizedText(value: string | undefined): string | undefined {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function accessibleName(element: BackendElement): string | undefined {
  return normalizedText(element.label ?? element.title)
}

function locatorKey(locator: readonly number[]): string {
  return locator.join('.')
}

function sameLocator(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameActions(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameAncestorFingerprint(
  left: readonly AncestorFingerprintEntry[],
  right: readonly AncestorFingerprintEntry[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((entry, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && entry.role === candidate.role
      && entry.subrole === candidate.subrole
      && entry.accessibleName === candidate.accessibleName
  })
}

function sameStableFields(left: ComputerTargetDescriptor, right: ComputerTargetDescriptor): boolean {
  return left.role === right.role
    && left.subrole === right.subrole
    && left.accessibleName === right.accessibleName
    && sameActions(left.availableActions, right.availableActions)
    && sameAncestorFingerprint(left.ancestorFingerprint, right.ancestorFingerprint)
}

function sameSemanticIdentity(left: ComputerTargetDescriptor, right: ComputerTargetDescriptor): boolean {
  return left.accessibleName !== undefined && sameStableFields(left, right)
}

function sameExactIdentity(left: ComputerTargetDescriptor, right: ComputerTargetDescriptor): boolean {
  if (left.nativeIdentifier !== undefined || right.nativeIdentifier !== undefined) {
    return left.nativeIdentifier === right.nativeIdentifier && sameStableFields(left, right)
  }
  if (!sameStableFields(left, right)) return false
  if (left.normalizedFrame === undefined || right.normalizedFrame === undefined) {
    return left.normalizedFrame === right.normalizedFrame
  }
  return sameRect(left.normalizedFrame, right.normalizedFrame)
}

function sameRect(left: ComputerRect, right: ComputerRect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
}

function sameWindow(left: BackendObservation['window'], right: BackendObservation['window']): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.id === right.id && left.title === right.title && sameRect(left.frame, right.frame)
}

function failAmbiguous(mode: 'native identifier' | 'semantic', candidateCount: number): never {
  throw new ComputerUseError(
    'COMPUTER_TARGET_AMBIGUOUS',
    `${mode} resolution found ${candidateCount} candidates in the selected process and window`,
  )
}

function failLowConfidence(candidateCount: number, reason: string): never {
  throw new ComputerUseError(
    'COMPUTER_TARGET_LOW_CONFIDENCE',
    `${reason}; candidateCount=${candidateCount}, confidence=0, required=${TARGET_RESOLUTION_CONFIDENCE.semanticThreshold}`,
  )
}

/** Build the normalized descriptor stored behind one opaque handle. */
export function describeComputerTarget(
  element: BackendElement,
  observation: BackendObservation,
): ComputerTargetDescriptor {
  const byLocator = new Map(observation.elements.map(candidate => [locatorKey(candidate.locator), candidate]))
  const ancestors: AncestorFingerprintEntry[] = []
  for (let depth = 0; depth < element.locator.length; depth += 1) {
    const ancestor = byLocator.get(locatorKey(element.locator.slice(0, depth)))
    if (ancestor === undefined) continue
    const name = accessibleName(ancestor)
    ancestors.push({
      role: ancestor.role,
      ...(ancestor.subrole === undefined ? {} : { subrole: ancestor.subrole }),
      ...(name === undefined ? {} : { accessibleName: name }),
    })
  }
  const nativeIdentifier = normalizedText(element.nativeIdentifier)
  const name = accessibleName(element)
  const normalizedFrame = element.frame === undefined
    ? undefined
    : observation.window === undefined
      ? { ...element.frame }
      : {
          x: element.frame.x - observation.window.frame.x,
          y: element.frame.y - observation.window.frame.y,
          width: element.frame.width,
          height: element.frame.height,
        }
  return {
    locator: [...element.locator],
    ...(nativeIdentifier === undefined ? {} : { nativeIdentifier }),
    role: element.role,
    ...(element.subrole === undefined ? {} : { subrole: element.subrole }),
    ...(name === undefined ? {} : { accessibleName: name }),
    ancestorFingerprint: ancestors.slice(-4),
    ...(normalizedFrame === undefined ? {} : { normalizedFrame }),
    availableActions: [...new Set(element.actions)].sort(),
  }
}

/** Resolve one descriptor against a fresh provider observation without guessing. */
export function resolveComputerTarget(
  original: BackendObservation,
  fresh: BackendObservation,
  expected: ComputerTargetDescriptor,
  allowRebind: boolean,
): ResolvedComputerTarget {
  if (fresh.app.bundleId !== original.app.bundleId || fresh.app.pid !== original.app.pid) {
    throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'the selected application restarted or resolved to a different process')
  }
  if (!sameWindow(original.window, fresh.window)) {
    throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'the selected window changed after the referenced observation')
  }

  const descriptors = fresh.elements.map(element => ({ element, descriptor: describeComputerTarget(element, fresh) }))
  const exact = descriptors.find(candidate => sameLocator(candidate.element.locator, expected.locator))
  if (exact !== undefined && sameExactIdentity(expected, exact.descriptor)) {
    return {
      element: exact.element,
      observation: fresh,
      resolution: {
        mode: 'exact-locator',
        confidence: TARGET_RESOLUTION_CONFIDENCE.exactLocator,
        candidateCount: 1,
        targetChanged: false,
      },
    }
  }
  if (!allowRebind) {
    throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'the target locator no longer identifies the selected element and rebinding was not allowed')
  }

  if (fresh.truncated) {
    failLowConfidence(0, 'target uniqueness cannot be established from a truncated fresh observation')
  }

  if (expected.nativeIdentifier !== undefined) {
    const nativeMatches = descriptors.filter(candidate => candidate.descriptor.nativeIdentifier === expected.nativeIdentifier)
    if (nativeMatches.length > 1) failAmbiguous('native identifier', nativeMatches.length)
    if (nativeMatches.length === 1) {
      if (!sameStableFields(expected, nativeMatches[0]!.descriptor)) {
        failLowConfidence(1, 'the native identifier resolved to an element with different stable semantics')
      }
      return {
        element: nativeMatches[0]!.element,
        observation: fresh,
        resolution: {
          mode: 'native-identifier',
          confidence: TARGET_RESOLUTION_CONFIDENCE.nativeIdentifier,
          candidateCount: 1,
          targetChanged: true,
        },
      }
    }
  }

  if (expected.accessibleName === undefined) {
    failLowConfidence(0, 'the target has no native identifier or accessible name')
  }
  const semanticMatches = descriptors.filter(candidate => sameSemanticIdentity(expected, candidate.descriptor))
  if (semanticMatches.length > 1) failAmbiguous('semantic', semanticMatches.length)
  if (semanticMatches.length === 0) failLowConfidence(0, 'no candidate retained the target role, accessible name, actions, and ancestor fingerprint')
  if (TARGET_RESOLUTION_CONFIDENCE.semantic < TARGET_RESOLUTION_CONFIDENCE.semanticThreshold) {
    failLowConfidence(semanticMatches.length, 'the deterministic semantic score is below the configured threshold')
  }
  return {
    element: semanticMatches[0]!.element,
    observation: fresh,
    resolution: {
      mode: 'semantic-rebind',
      confidence: TARGET_RESOLUTION_CONFIDENCE.semantic,
      candidateCount: semanticMatches.length,
      targetChanged: true,
    },
  }
}
