/** Non-macOS fallback backend: keeps the Service injectable, fails closed, and reports an unavailable health state. */

import type {
  BackendActionRequest,
  BackendActionResult,
  BackendCursorActivation,
  BackendCursorAction,
  BackendHealth,
  BackendObservation,
  BackendObserveOptions,
  ComputerUseBackend,
  CursorVisibility,
} from '../backend.ts'
import { ComputerUseError } from '../errors.ts'
import type { ComputerAppIdentity, ComputerAppSelector, ComputerAppSummary } from '../types.ts'

function unsupported(platform: NodeJS.Platform): ComputerUseError {
  return new ComputerUseError(
    'COMPUTER_UNSUPPORTED_PLATFORM',
    `dsh-computer-use supports macOS only; Computer Use is disabled on ${platform}`,
  )
}

/** Backend that reports a clear unavailable state instead of failing profile startup on non-macOS hosts. */
export class UnsupportedPlatformBackend implements ComputerUseBackend {
  readonly name = 'unsupported' as const
  readonly helperPath = ''

  constructor(private readonly platform: NodeJS.Platform) {}

  async health(): Promise<BackendHealth> {
    const failure = unsupported(this.platform)
    return {
      ready: false,
      error: failure.message,
      helperVersion: 'unsupported',
      helperSha256: '',
      accessibility: 'unavailable',
      screenRecording: 'unavailable',
    }
  }

  resolveApp(_selector: ComputerAppSelector): Promise<ComputerAppIdentity> {
    return Promise.reject(unsupported(this.platform))
  }

  listApps(): Promise<ComputerAppSummary[]> {
    return Promise.reject(unsupported(this.platform))
  }

  observe(_app: ComputerAppIdentity, _options: BackendObserveOptions): Promise<BackendObservation> {
    return Promise.reject(unsupported(this.platform))
  }

  activateForCursor(_app: ComputerAppIdentity, _expectedStateHash: string, _options: BackendObserveOptions): Promise<BackendCursorActivation> {
    return Promise.reject(unsupported(this.platform))
  }

  act(_request: BackendActionRequest): Promise<BackendActionResult> {
    return Promise.reject(unsupported(this.platform))
  }

  visualizeCursor(_action: BackendCursorAction, _phase: 'before' | 'during' | 'after'): Promise<CursorVisibility> {
    return Promise.reject(unsupported(this.platform))
  }

  openSettings(_kind: 'accessibility' | 'screen-recording'): Promise<void> {
    return Promise.reject(unsupported(this.platform))
  }

  async dispose(): Promise<void> {}
}
