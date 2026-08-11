import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      cordis: fileURLToPath(new URL('../vendor/cordis/lib/index.js', import.meta.url)),
      schemastery: fileURLToPath(new URL('../vendor/schemastery/lib/index.mjs', import.meta.url)),
      '@deepseek-ai/dsh-settings': fileURLToPath(new URL('../packages/settings/settings/lib/index.js', import.meta.url)),
      '@deepseek-ai/dsh-tools': fileURLToPath(new URL('../packages/core/tools/lib/index.js', import.meta.url)),
      '@deepseek-ai/dsh-user-approval': fileURLToPath(new URL('../packages/interaction/user-approval/lib/index.js', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    fileParallelism: false,
  },
})
