import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { zstdCompress } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { findComputerClickEvidence, readSessionRecords } from '../scripts/session-transcript.mjs'
import { temporaryDirectory } from './helpers.ts'

const compressZstd = promisify(zstdCompress)

describe('real-model Session evidence', () => {
  it('reads every concatenated Zstandard frame and finds the exact computer_click result', async () => {
    const directory = await temporaryDirectory('dsh-computer-session-evidence-')
    try {
      const path = join(directory.path, 'session.jsonl.zstd')
      const header = { type: 'session', version: 0, id: 'session-evidence', createdAt: 1, delegationDepth: 0 }
      const call = {
        type: 'tool/call',
        seq: 0,
        time: 2,
        data: {
          callId: 'call-pointer',
          name: 'computer_click',
          arguments: JSON.stringify({ observationId: 'observation-1', elementIndex: 4, allowCoordinateFallback: true }),
        },
      }
      const result = {
        type: 'tool/result',
        seq: 1,
        time: 3,
        data: {
          message: {
            source: { kind: 'tool', callId: 'call-pointer' },
            content: [{
              type: 'tool-result',
              toolCallId: 'call-pointer',
              content: [{
                type: 'text',
                text: JSON.stringify({
                  action: 'click',
                  channel: 'coordinates',
                  activation: 'not-requested',
                  pointerInput: true,
                  pointerRouting: 'target-process',
                }),
              }],
              isError: false,
            }],
          },
        },
      }
      const frames = await Promise.all([
        `${JSON.stringify(header)}\n`,
        `${JSON.stringify(call)}\n`,
        `${JSON.stringify(result)}\n`,
      ].map(value => compressZstd(value)))
      await writeFile(path, Buffer.concat(frames))

      await expect(readSessionRecords(path)).resolves.toHaveLength(3)
      await expect(findComputerClickEvidence(directory.path)).resolves.toEqual({
        time: 3,
        sessionId: 'session-evidence',
        callId: 'call-pointer',
        allowCoordinateFallback: true,
        activation: 'not-requested',
        pointerInput: true,
        pointerRouting: 'target-process',
      })
    } finally {
      await directory.cleanup()
    }
  })
})
