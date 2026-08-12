import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528
const decompressZstd = promisify(zstdDecompress)

function zstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 5 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid Zstandard session frame at byte ${offset}`)
    }
    offset += 4
    const descriptor = buffer.readUInt8(offset++)
    if ((descriptor & 0x18) !== 0) throw new Error(`invalid Zstandard frame descriptor at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < headerBytes) throw new Error(`truncated Zstandard session frame at byte ${start}`)
    offset += headerBytes
    for (;;) {
      if (buffer.length - offset < 3) throw new Error(`truncated Zstandard session frame at byte ${start}`)
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error(`invalid Zstandard block at byte ${offset - 3}`)
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) throw new Error(`truncated Zstandard session frame at byte ${start}`)
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) throw new Error(`truncated Zstandard checksum at byte ${start}`)
      offset += 4
    }
    frames.push(buffer.subarray(start, offset))
  }
  return frames
}

async function sessionLogs(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await sessionLogs(path))
    else if (entry.isFile() && (entry.name === 'session.jsonl' || entry.name === 'session.jsonl.zstd')) result.push(path)
  }
  return result
}

/** Read every JSON record from one plain or concatenated-frame DSH Session log. */
export async function readSessionRecords(path) {
  const encoded = await readFile(path)
  const decoded = path.endsWith('.zstd')
    ? Buffer.concat(await Promise.all(zstdFrames(encoded).map(frame => decompressZstd(frame))))
    : encoded
  return decoded.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function resultValue(event) {
  const outer = event?.data?.message?.content
  if (!Array.isArray(outer)) return undefined
  for (const block of outer) {
    if (block?.type !== 'tool-result' || !Array.isArray(block.content)) continue
    for (const content of block.content) {
      if (content?.type !== 'text' || typeof content.text !== 'string') continue
      try { return JSON.parse(content.text) }
      catch { return undefined }
    }
  }
  return undefined
}

/** Locate the durable model-visible result for the target-process pointer probe. */
export async function findComputerClickEvidence(sessionRoot) {
  const candidates = []
  for (const path of await sessionLogs(sessionRoot)) {
    const records = await readSessionRecords(path)
    const header = records.find(record => record?.type === 'session')
    const calls = new Map(records
      .filter(record => record?.type === 'tool/call' && record?.data?.name === 'computer_click')
      .map(record => [record.data.callId, record]))
    for (const record of records) {
      if (record?.type !== 'tool/result') continue
      const callId = record?.data?.message?.source?.callId
      const call = calls.get(callId)
      if (call === undefined) continue
      let args
      try { args = JSON.parse(call.data.arguments) }
      catch { continue }
      const result = resultValue(record)
      if (result?.action !== 'click') continue
      candidates.push({
        time: record.time ?? 0,
        sessionId: header?.id,
        callId,
        allowCoordinateFallback: args.allowCoordinateFallback === true,
        activation: result.activation,
        pointerInput: result.pointerInput,
        pointerRouting: result.pointerRouting,
      })
    }
  }
  const evidence = candidates.sort((left, right) => right.time - left.time)[0]
  if (evidence === undefined) throw new Error('durable Session transcript contains no completed computer_click result')
  return evidence
}
