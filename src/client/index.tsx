/** DSH Computer Use browser plugin: provider health, permissions, limits, and app policy. */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

const NS = 'computer-use'
const ROUTE = '/_dsh/computer-use/settings'

const en = {
  nav: 'Computer Use',
  title: 'macOS Computer Use',
  intro: 'Inspect the native helper, macOS privacy permissions, observation limits, and exact per-app read/control grants.',
  helper: 'Native helper',
  ready: 'Ready',
  unavailable: 'Unavailable',
  generation: 'Generation',
  accessibility: 'Accessibility',
  screenRecording: 'Screen Recording',
  granted: 'Granted',
  denied: 'Needs permission',
  openSettings: 'Open macOS Settings',
  refresh: 'Refresh health',
  limits: 'Observation and action limits',
  ttl: 'Observation TTL (ms)',
  confirmationTtl: 'Confirmation TTL (ms)',
  actionTimeout: 'Action timeout (ms)',
  settle: 'Settlement interval (ms)',
  maxSettle: 'Maximum settlement (ms)',
  maxNodes: 'Maximum AX nodes',
  maxDepth: 'Maximum AX depth',
  maxText: 'Maximum AX text bytes',
  maxScreenshot: 'Maximum screenshot bytes',
  artifactRoot: 'Artifact root',
  helperPath: 'External helper path',
  sourceBuild: 'Allow explicit source-build fallback',
  grants: 'Application grants',
  grantsHint: 'One exact bundle id per line, followed by read or read,control. Wildcards are rejected.',
  save: 'Save and apply',
  saving: 'Applying...',
  saved: 'Settings applied.',
  readOnly: 'The current Settings provider is read-only.',
  loading: 'Loading Computer Use settings...',
  retry: 'Retry',
} as const

type LocaleKey = keyof typeof en
const zh: Record<LocaleKey, string> = {
  nav: 'Computer Use',
  title: 'macOS Computer Use',
  intro: '检查原生 helper、macOS 隐私权限、观察限制，以及按应用配置的精确 read/control grant。',
  helper: '原生 helper',
  ready: '可用',
  unavailable: '不可用',
  generation: '世代',
  accessibility: '辅助功能',
  screenRecording: '屏幕录制',
  granted: '已授权',
  denied: '需要授权',
  openSettings: '打开 macOS 设置',
  refresh: '刷新健康状态',
  limits: '观察与动作限制',
  ttl: 'Observation TTL（毫秒）',
  confirmationTtl: '确认 Token TTL（毫秒）',
  actionTimeout: '动作超时（毫秒）',
  settle: '稳定检查间隔（毫秒）',
  maxSettle: '最大稳定等待（毫秒）',
  maxNodes: '最大 AX 节点数',
  maxDepth: '最大 AX 深度',
  maxText: '最大 AX 文本字节数',
  maxScreenshot: '最大截图字节数',
  artifactRoot: 'Artifact 目录',
  helperPath: '外部 helper 路径',
  sourceBuild: '允许显式源码构建 fallback',
  grants: '应用授权',
  grantsHint: '每行一个精确 bundle id，后接 read 或 read,control；不接受通配符。',
  save: '保存并应用',
  saving: '正在应用...',
  saved: '设置已生效。',
  readOnly: '当前 Settings 提供方为只读。',
  loading: '正在加载 Computer Use 设置...',
  retry: '重试',
}

type Translate = (key: LocaleKey) => string

interface ConfigValue {
  observationTtlMs?: number
  confirmationTtlMs?: number
  actionTimeoutMs?: number
  settleMs?: number
  maxSettleMs?: number
  maxNodes?: number
  maxDepth?: number
  maxTextBytes?: number
  maxScreenshotBytes?: number
  artifactRoot?: string
  helper?: { path?: string; allowSourceBuild?: boolean }
  grants?: Array<{ bundleId: string; read?: boolean; control?: boolean }>
}

interface Snapshot {
  schemaVersion: 1
  writable: boolean
  settings: { value: ConfigValue; revision: number; applies: 'live' }
  provider: {
    platform: string
    provider: string
    generation: number
    ready: boolean
    helperPath: string
    helperVersion?: string
    helperSha256?: string
    accessibility: string
    screenRecording: string
    lastError?: string
  }
}

interface ControllerState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  action?: 'save' | 'health' | 'open'
  snapshot?: Snapshot
  error?: string
  notice?: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DSH Computer Use Settings copy. */
    'computer-use': LocaleKey
  }
}

class ComputerUseSettingsController {
  private state: ControllerState = { status: 'idle' }
  private readonly listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  readonly snapshot = (): ControllerState => this.state

  private publish(next: ControllerState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  async load(): Promise<void> {
    this.publish({
      status: 'loading',
      ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }),
    })
    try {
      const response = await fetch(ROUTE, { credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json() as { ok: boolean; value?: Snapshot; error?: { message?: string } }
      if (!response.ok || body.ok !== true || body.value === undefined) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
      this.publish({ status: 'ready', snapshot: body.value })
    } catch (error) {
      this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  async action(
    action: 'save' | 'health' | 'open-settings',
    payload: Record<string, unknown>,
    marker: NonNullable<ControllerState['action']>,
  ): Promise<void> {
    this.publish({
      status: this.state.status,
      action: marker,
      ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }),
    })
    try {
      const response = await fetch(ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      })
      const body = await response.json() as { ok: boolean; value?: Snapshot; error?: { message?: string } }
      if (!response.ok || body.ok !== true || body.value === undefined) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
      this.publish({
        status: 'ready',
        snapshot: body.value,
        ...(action === 'save' ? { notice: 'saved' } : {}),
      })
    } catch (error) {
      this.publish({
        status: 'ready',
        ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  refreshIfLoaded(): void {
    if (this.state.status !== 'idle') void this.load()
  }
}

interface Draft {
  observationTtlMs: string
  confirmationTtlMs: string
  actionTimeoutMs: string
  settleMs: string
  maxSettleMs: string
  maxNodes: string
  maxDepth: string
  maxTextBytes: string
  maxScreenshotBytes: string
  artifactRoot: string
  helperPath: string
  allowSourceBuild: boolean
  grants: string
}

function draftOf(value: ConfigValue): Draft {
  return {
    observationTtlMs: String(value.observationTtlMs ?? 15000),
    confirmationTtlMs: String(value.confirmationTtlMs ?? 300000),
    actionTimeoutMs: String(value.actionTimeoutMs ?? 15000),
    settleMs: String(value.settleMs ?? 250),
    maxSettleMs: String(value.maxSettleMs ?? 5000),
    maxNodes: String(value.maxNodes ?? 500),
    maxDepth: String(value.maxDepth ?? 14),
    maxTextBytes: String(value.maxTextBytes ?? 64000),
    maxScreenshotBytes: String(value.maxScreenshotBytes ?? 33554432),
    artifactRoot: value.artifactRoot ?? '.dsh-computer-use/artifacts',
    helperPath: value.helper?.path ?? '',
    allowSourceBuild: value.helper?.allowSourceBuild ?? false,
    grants: (value.grants ?? []).map(grant => `${grant.bundleId} ${grant.control === true ? 'read,control' : 'read'}`).join('\n'),
  }
}

function integer(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`)
  return parsed
}

function configOf(draft: Draft): ConfigValue {
  const grants = draft.grants.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map((line) => {
    const [bundleId, rawScopes, ...extra] = line.split(/\s+/u)
    if (bundleId === undefined || rawScopes === undefined || extra.length > 0) throw new Error(`invalid grant line: ${line}`)
    const scopes = new Set(rawScopes.split(','))
    if (![...scopes].every(scope => scope === 'read' || scope === 'control')) throw new Error(`invalid grant scope: ${line}`)
    return { bundleId, read: true, control: scopes.has('control') }
  })
  return {
    observationTtlMs: integer(draft.observationTtlMs, 'observationTtlMs'),
    confirmationTtlMs: integer(draft.confirmationTtlMs, 'confirmationTtlMs'),
    actionTimeoutMs: integer(draft.actionTimeoutMs, 'actionTimeoutMs'),
    settleMs: integer(draft.settleMs, 'settleMs'),
    maxSettleMs: integer(draft.maxSettleMs, 'maxSettleMs'),
    maxNodes: integer(draft.maxNodes, 'maxNodes'),
    maxDepth: integer(draft.maxDepth, 'maxDepth'),
    maxTextBytes: integer(draft.maxTextBytes, 'maxTextBytes'),
    maxScreenshotBytes: integer(draft.maxScreenshotBytes, 'maxScreenshotBytes'),
    artifactRoot: draft.artifactRoot.trim(),
    helper: {
      ...(draft.helperPath.trim().length === 0 ? {} : { path: draft.helperPath.trim() }),
      allowSourceBuild: draft.allowSourceBuild,
    },
    grants,
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="dcu-field"><span>{label}</span>{children}</label>
}

type SettingsProps = PropsRuntime<'settings.section'> & { controller?: ComputerUseSettingsController; t?: Translate }

function SettingsSection({ controller, t }: SettingsProps) {
  if (controller === undefined || t === undefined) return null
  return <LoadedSettings controller={controller} t={t} />
}

function PermissionCard({ label, state, kind, controller, t }: {
  label: string
  state: string
  kind: 'accessibility' | 'screen-recording'
  controller: ComputerUseSettingsController
  t: Translate
}) {
  const granted = state === 'granted'
  return <article className="dcu-permission" data-granted={granted || undefined}>
    <div><span>{label}</span><strong>{granted ? t('granted') : t('denied')}</strong></div>
    {!granted ? <Button variant="outline" onClick={() => { void controller.action('open-settings', { kind }, 'open') }}>{t('openSettings')}</Button> : null}
  </article>
}

function LoadedSettings({ controller, t }: { controller: ComputerUseSettingsController; t: Translate }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const [draft, setDraft] = useState<Draft>()
  const [draftError, setDraftError] = useState<string>()
  useEffect(() => { if (state.status === 'idle') void controller.load() }, [controller, state.status])
  useEffect(() => { if (state.snapshot !== undefined) setDraft(draftOf(state.snapshot.settings.value)) }, [state.snapshot])
  if (state.snapshot === undefined || draft === undefined) {
    return <div className="dcu-settings"><div className="dcu-panel">{state.error ?? t('loading')}</div>{state.status === 'error' ? <Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button> : null}</div>
  }
  const snapshot = state.snapshot
  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft(current => current === undefined ? current : { ...current, [key]: value })
  const save = (): void => {
    try {
      setDraftError(undefined)
      void controller.action('save', { expectedRevision: snapshot.settings.revision, value: configOf(draft) }, 'save')
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error))
    }
  }
  const numberField = (key: keyof Draft, label: string) => <Field label={label}><Input value={String(draft[key])} onChange={event => update(key, event.target.value as never)} /></Field>
  return <div className="dcu-settings">
    <header className="dcu-header">
      <div><span className="dcu-kicker">DSH native capability</span><h2>{t('title')}</h2><p>{t('intro')}</p></div>
      <div className="dcu-release"><span>{t('helper')} <strong>{snapshot.provider.helperVersion ?? 'unknown'}</strong></span><span>{t('generation')} <strong>{snapshot.provider.generation}</strong></span><span className={snapshot.provider.ready ? 'ok' : 'bad'}>{snapshot.provider.ready ? t('ready') : t('unavailable')}</span></div>
    </header>
    {snapshot.provider.lastError === undefined ? null : <div className="dcu-alert error">{snapshot.provider.lastError}</div>}
    {!snapshot.writable ? <div className="dcu-alert warning">{t('readOnly')}</div> : null}
    {state.error === undefined && draftError === undefined ? null : <div className="dcu-alert error">{draftError ?? state.error}</div>}
    {state.notice === 'saved' ? <div className="dcu-alert ok">{t('saved')}</div> : null}
    <section className="dcu-panel">
      <div className="dcu-panel-title"><h3>macOS privacy</h3><Button variant="outline" onClick={() => { void controller.action('health', {}, 'health') }}>{t('refresh')}</Button></div>
      <div className="dcu-permissions">
        <PermissionCard label={t('accessibility')} state={snapshot.provider.accessibility} kind="accessibility" controller={controller} t={t} />
        <PermissionCard label={t('screenRecording')} state={snapshot.provider.screenRecording} kind="screen-recording" controller={controller} t={t} />
      </div>
      <code className="dcu-path">{snapshot.provider.helperPath}</code>
      {snapshot.provider.helperSha256 === undefined ? null : <code className="dcu-path">sha256 {snapshot.provider.helperSha256}</code>}
    </section>
    <section className="dcu-panel">
      <div className="dcu-panel-title"><h3>{t('limits')}</h3></div>
      <div className="dcu-grid">
        {numberField('observationTtlMs', t('ttl'))}
        {numberField('confirmationTtlMs', t('confirmationTtl'))}
        {numberField('actionTimeoutMs', t('actionTimeout'))}
        {numberField('settleMs', t('settle'))}
        {numberField('maxSettleMs', t('maxSettle'))}
        {numberField('maxNodes', t('maxNodes'))}
        {numberField('maxDepth', t('maxDepth'))}
        {numberField('maxTextBytes', t('maxText'))}
        {numberField('maxScreenshotBytes', t('maxScreenshot'))}
        <Field label={t('artifactRoot')}><Input value={draft.artifactRoot} onChange={event => update('artifactRoot', event.target.value)} /></Field>
        <Field label={t('helperPath')}><Input value={draft.helperPath} placeholder="managed" onChange={event => update('helperPath', event.target.value)} /></Field>
        <label className="dcu-check"><input type="checkbox" checked={draft.allowSourceBuild} onChange={event => update('allowSourceBuild', event.target.checked)} /><span>{t('sourceBuild')}</span></label>
      </div>
    </section>
    <section className="dcu-panel">
      <div className="dcu-panel-title"><div><h3>{t('grants')}</h3><p>{t('grantsHint')}</p></div></div>
      <textarea value={draft.grants} onChange={event => update('grants', event.target.value)} placeholder={'com.example.App read\ncom.example.Editor read,control'} />
    </section>
    <div className="dcu-actions"><Button disabled={!snapshot.writable || state.action !== undefined} onClick={save}>{state.action === 'save' ? t('saving') : t('save')}</Button></div>
  </div>
}

const CSS = `
.dcu-settings{display:grid;gap:14px;max-width:920px;padding:2px 0 24px}.dcu-header{display:flex;justify-content:space-between;gap:22px;align-items:flex-start;padding:18px 20px;border-radius:16px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2,#f5f4f1),var(--dsw-alias-bg-layer-1,#fff));border:1px solid var(--dsw-alias-border-subtle,#dedbd5)}.dcu-header h2{margin:4px 0 6px;font-size:20px}.dcu-header p{margin:0;max-width:610px;font-size:12px;line-height:1.55;color:var(--dsw-alias-fg-muted,#706d67)}.dcu-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#687f74;font-weight:700}.dcu-release{display:grid;gap:5px;min-width:190px;padding:10px 12px;border-radius:11px;background:rgba(255,255,255,.58);font-size:10px}.dcu-release span{display:flex;justify-content:space-between;gap:12px}.dcu-release .ok{color:#277d52}.dcu-release .bad{color:#aa3939}.dcu-panel{display:grid;gap:13px;padding:16px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff)}.dcu-panel-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.dcu-panel-title h3{margin:0;font-size:14px}.dcu-panel-title p{margin:4px 0 0;font-size:10px;color:var(--dsw-alias-fg-muted,#706d67)}.dcu-permissions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dcu-permission{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px;border-radius:11px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);border-left:3px solid #cc5555}.dcu-permission[data-granted]{border-left-color:#3ca26b}.dcu-permission div{display:grid;gap:3px}.dcu-permission span{font-size:10px}.dcu-permission strong{font-size:11px}.dcu-path{display:block;overflow:auto;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);font-size:10px;color:var(--dsw-alias-fg-muted,#706d67)}.dcu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.dcu-field{display:grid;gap:5px}.dcu-field>span{font-size:10px;font-weight:650}.dcu-check{display:flex;align-items:center;gap:8px;padding-top:19px;font-size:11px}.dcu-panel textarea{min-height:110px;resize:vertical;padding:10px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.dcu-alert{padding:10px 12px;border-radius:10px;font-size:11px}.dcu-alert.error{background:rgba(205,72,72,.1);color:#a13b3b}.dcu-alert.warning{background:rgba(211,151,49,.12);color:#8b651f}.dcu-alert.ok{background:rgba(48,154,100,.12);color:#267d52}.dcu-actions{display:flex;justify-content:flex-end}@media(max-width:720px){.dcu-header{display:grid}.dcu-release{width:auto}.dcu-grid,.dcu-permissions{grid-template-columns:1fr}}
`

function installStyles(): () => void {
  const id = '@dsh-external/dsh-computer-use/client'
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = '@dsh-external/dsh-computer-use'
  style.dataset.pluginCss = id
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Required browser services. */
export const inject = ['slots', 'locale']

/** Register the Computer Use Settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'dsh-computer-use: styles')
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-computer-use: locale')
  const t = ctx.locale.bind(NS)
  const controller = new ComputerUseSettingsController()
  ctx.effect(() => {
    const disposers = [
      ctx.on('settings/changed', namespace => { if (namespace === 'computer-use') controller.refreshIfLoaded() }),
      ctx.on('connection/reset', () => { controller.refreshIfLoaded() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-computer-use: Settings invalidation')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'computer-use',
    order: 35,
    label: () => t('nav'),
    inject: () => ({ controller, t }),
  }, SettingsSection))
}
