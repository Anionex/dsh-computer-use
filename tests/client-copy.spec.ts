import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { integerInRange } from '../src/client/settings-validation.ts'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

describe('Computer Use settings copy and hierarchy', () => {
  it('rejects cursor values outside host bounds with localized copy', () => {
    const zh = (field: string, min: number, max: number): string => `${field}必须是 ${min} 到 ${max} 之间的整数。`
    expect(integerInRange('100', '光标速度', 100, 50000, zh)).toBe(100)
    expect(() => integerInRange('50001', '光标速度', 100, 50000, zh))
      .toThrow('光标速度必须是 100 到 50000 之间的整数。')
    expect(() => integerInRange('1.5', '点击延迟', 0, 1000, zh))
      .toThrow('点击延迟必须是 0 到 1000 之间的整数。')
  })

  it('keeps the common flow before advanced settings and diagnostics', async () => {
    const source = await readFile(join(ROOT, 'src/client/index.tsx'), 'utf8')
    const privacy = source.indexOf("<h3>{t('privacy')}</h3>")
    const access = source.indexOf("<h3>{t('access')}</h3>")
    const save = source.indexOf("state.action === 'save'")
    const advanced = source.indexOf('<details className="dcu-advanced">')
    const footer = source.indexOf('<footer className="dcu-footer">')
    expect([privacy, access, save, advanced, footer].every(index => index >= 0)).toBe(true)
    expect(privacy).toBeLessThan(access)
    expect(access).toBeLessThan(save)
    expect(save).toBeLessThan(advanced)
    expect(advanced).toBeLessThan(footer)
    expect(source.match(/state\.action === 'save'/gu)).toHaveLength(1)
    expect(source).not.toContain('DSH native capability')
    expect(source).not.toContain("generation: '世代'")
  })
})
