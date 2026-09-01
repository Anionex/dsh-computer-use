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

/** Internal provider evidence never exposed to the model or persisted in Session logs. */
export interface BackendElement extends Omit<ComputerElement, 'targetHandle'> {
  locator: number[]
  nativeIdentifier?: string
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

/** Action bound to fresh provider state and one exact internally resolved target. */
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

/** One model-selected point or gesture for the non-interactive Agent cursor overlay. */
/** Whether the agent cursor ended up visible, and why not when it did not. */
export interface CursorVisibility {
  readonly visible: boolean
  readonly reason?: string
  readonly reasonCode?: 'target-not-frontmost' | 'target-invalid'
}

export interface BackendCursorAction {
  kind: 'click' | 'scroll' | 'drag'
  from?: { x: number; y: number }
  to: { x: number; y: number }
  /** Exact target identity used to prevent the overlay from lingering over another window. */
  targetPid: number
  targetWindowNumber: number
  targetWindowFrame: ComputerRect
}

/** Health facts obtained without changing permissions. */
export interface BackendHealth {
  helperVersion: string
  helperSha256: string
  accessibility: ComputerPermissionState
  screenRecording: ComputerPermissionState
  /** False when the provider is intentionally disabled on this host (for example non-macOS). */
  ready?: boolean
  /** Operator-facing reason shown in Settings when `ready` is false. */
  error?: string
}

/** Platform backend used by the provider-independent Service implementation. */
export interface ComputerUseBackend {
  readonly name: 'macos-ax' | 'unsupported'
  readonly helperPath: string
  resolveApp(selector: ComputerAppSelector, signal: AbortSignal): Promise<ComputerAppIdentity>
  listApps(signal: AbortSignal): Promise<ComputerAppSummary[]>
  observe(app: ComputerAppIdentity, options: BackendObserveOptions, signal: AbortSignal): Promise<BackendObservation>
  act(request: BackendActionRequest, signal: AbortSignal): Promise<BackendActionResult>
  /**
   * Drive the agent cursor for one action.
   * @returns whether the cursor is on screen afterwards, plus why not when it
   * is hidden. A hidden cursor is not an error — native input is unaffected —
   * but the caller must be able to report that the user cannot see the agent.
   */
  visualizeCursor(action: BackendCursorAction, phase: 'before' | 'after', signal: AbortSignal): Promise<CursorVisibility>
  dispose(): Promise<void>
  health(signal: AbortSignal): Promise<BackendHealth>
  openSettings(kind: 'accessibility' | 'screen-recording', signal: AbortSignal): Promise<void>
}
