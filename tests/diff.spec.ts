import { describe, expect, it } from 'vitest'
import { diffElements } from '../src/diff.ts'
import type { ComputerElement } from '../src/types.ts'

function element(index: number, overrides: Partial<ComputerElement> = {}): ComputerElement {
  return { index, role: 'AXButton', title: 'Apply', actions: ['AXPress'], ...overrides }
}

describe('Accessibility diff projection', () => {
  it('reports removed, added, and changed current rows with current indexes', () => {
    const previous = [
      element(2, { title: 'Removed' }),
      element(3, { title: 'Changed', value: 'before' }),
    ]
    const current = [
      element(7, { title: 'Changed', value: 'after' }),
      element(8, { title: 'Added' }),
    ]
    expect(diffElements(previous, current, 4096)).toBe([
      '- AXButton "Removed"',
      '~ [7] AXButton "Changed" value="after"',
      '+ [8] AXButton "Added"',
    ].join('\n'))
  })

  it('returns a stable empty marker and truncates by UTF-8 bytes', () => {
    const rows = [element(0, { title: '同一个控件' })]
    expect(diffElements(rows, rows, 1024)).toBe('(no accessibility changes)')
    const diff = diffElements([], [element(1, { title: '非常长的控件名称'.repeat(20) })], 64)
    expect(Buffer.byteLength(diff)).toBeLessThanOrEqual(67)
    expect(diff).toContain('diff truncated')
  })
})
