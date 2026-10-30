#!/usr/bin/env node
// Exercise the installed official host's evaluator; never grant version exemptions.
import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const cli = process.argv[2] ?? process.env.DSH_TEST_CLI
assert.ok(cli, 'Pass the exact installed DSH CLI path')
const hostRequire = createRequire(await realpath(cli))
const { evaluatePluginCompatibility } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-app-boot')).href)
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const previous = structuredClone(manifest)
for (const [name, range] of Object.entries(previous.peerDependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) previous.peerDependencies[name] = range.replace(' || 0.2.1-rc.5', '')
}
const blocked = evaluatePluginCompatibility(previous, {}, '0.2.1-rc.5')
assert.equal(Object.keys(blocked.requirements).length, 18)
assert.equal(blocked.exempted, false)
for (const version of ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.5']) {
  assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version)
}
for (const version of ['0.2.1-rc.4', '0.2.1-rc.6', '0.2.1', '0.2.2-rc.1', '0.3.0']) {
  const issue = evaluatePluginCompatibility(manifest, {}, version)
  assert.equal(Object.keys(issue.requirements).length, 18, version)
  assert.equal(issue.exempted, false, version)
}
console.log('Official host compatibility evaluator: baseline rc.5 rejected; candidate rc.5 accepted; prior releases preserved; unverified releases rejected; no exemptions')
