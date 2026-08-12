/** Provider-facing backend protocol kept below the public Computer Use Service. */

import type {
  ComputerActionRequest,
  ComputerAppIdentity,
  ComputerAppSelector,
  ComputerAppSummary,
  ComputerElement,
  ComputerPermissionState,
  ComputerRect,
  ComputerScreenshotMode,
} from './types.ts'
import type { ResolvedComputerUseConfig } from './config.ts'

/** Internal element locator never exposed to the model or persisted in Session logs. */
export interface BackendElement extends ComputerElement {
  locator: number[]
}

/** Raw full-state observation returned by a provider before Service diff projection. */
export interface BackendObservation {
  app: ComputerAppIdentity
  stateHash: string
  frontmost: boolean
  window?: {
    title?: string
    frame: ComputerRect
    id?: number
  }
  treeText: string
  truncated: boolean
  elements: BackendElement[]
  screenshot?: {
    path: string
    width: number
    height: number
  }
  permissions: {
    accessibility: ComputerPermissionState
    screenRecording: ComputerPermissionState
  }
}

/** Provider limits resolved by the configuration owner before a call. */
export interface BackendObserveOptions {
  screenshot: ComputerScreenshotMode
  screenshotPath?: string
  maxNodes: number
  maxDepth: number
  maxTextBytes: number
}

/** Action bound to the exact provider state and internal target locator. */
export interface BackendActionRequest {
  action: Exclude<ComputerActionRequest, { kind: 'wait' }>
  app: ComputerAppIdentity
  expectedStateHash: string
  interaction: ResolvedComputerUseConfig['interaction']
  element?: BackendElement
  window?: BackendObservation['window']
}

/** Provider action outcome before the Service obtains the mandatory post-action observation. */
export interface BackendActionResult {
  channel: 'accessibility' | 'coordinates' | 'keyboard'
  activation: 'not-requested' | 'already-frontmost' | 'activated'
  pointerInput: boolean
  pointerRouting: 'none' | 'target-process'
}

/** Health facts obtained without changing permissions. */
export interface BackendHealth {
  helperVersion: string
  helperSha256: string
  accessibility: ComputerPermissionState
  screenRecording: ComputerPermissionState
}

/** Platform backend used by the provider-independent Service implementation. */
export interface ComputerUseBackend {
  readonly name: 'macos-ax'
  readonly helperPath: string
  resolveApp(selector: ComputerAppSelector, signal: AbortSignal): Promise<ComputerAppIdentity>
  listApps(signal: AbortSignal): Promise<ComputerAppSummary[]>
  observe(app: ComputerAppIdentity, options: BackendObserveOptions, signal: AbortSignal): Promise<BackendObservation>
  act(request: BackendActionRequest, signal: AbortSignal): Promise<BackendActionResult>
  health(signal: AbortSignal): Promise<BackendHealth>
  openSettings(kind: 'accessibility' | 'screen-recording', signal: AbortSignal): Promise<void>
}
