/** Accessibility-tree diff projection for model-context efficiency. */

import type { ComputerElement } from './types.ts'

function identity(element: ComputerElement): string {
  const frame = element.frame === undefined
    ? ''
    : `${Math.round(element.frame.x)},${Math.round(element.frame.y)},${Math.round(element.frame.width)},${Math.round(element.frame.height)}`
  return [element.role, element.subrole ?? '', element.title ?? '', element.label ?? '', frame].join('|')
}

function summary(element: ComputerElement, includeIndex: boolean): string {
  const parts = [includeIndex ? `[${element.index}]` : undefined, element.role]
  if (element.title !== undefined) parts.push(JSON.stringify(element.title))
  else if (element.label !== undefined) parts.push(JSON.stringify(element.label))
  if (element.value !== undefined) parts.push(`value=${JSON.stringify(element.value)}`)
  if (element.enabled === false) parts.push('disabled')
  if (element.focused === true) parts.push('focused')
  if (element.selected === true) parts.push('selected')
  return parts.filter((part): part is string => part !== undefined).join(' ')
}

function state(element: ComputerElement): string {
  return JSON.stringify({
    value: element.value,
    enabled: element.enabled,
    focused: element.focused,
    selected: element.selected,
    actions: element.actions,
  })
}

/** Return a bounded full-to-full element diff whose current rows use current indexes. */
export function diffElements(previous: readonly ComputerElement[], current: readonly ComputerElement[], maxBytes: number): string {
  const before = new Map(previous.map(element => [identity(element), element]))
  const after = new Map(current.map(element => [identity(element), element]))
  const lines: string[] = []
  for (const [key, element] of before) {
    if (!after.has(key)) lines.push(`- ${summary(element, false)}`)
  }
  for (const [key, element] of after) {
    const old = before.get(key)
    if (old === undefined) lines.push(`+ ${summary(element, true)}`)
    else if (state(old) !== state(element)) lines.push(`~ ${summary(element, true)}`)
  }
  if (lines.length === 0) return '(no accessibility changes)'
  const text = lines.join('\n')
  const bytes = Buffer.byteLength(text)
  if (bytes <= maxBytes) return text
  const suffix = '\n… diff truncated'
  return `${Buffer.from(text).subarray(0, Math.max(0, maxBytes - Buffer.byteLength(suffix))).toString('utf8')}${suffix}`
}
