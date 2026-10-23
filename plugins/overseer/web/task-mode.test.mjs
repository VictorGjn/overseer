// The plugin listing says task, never lot. (The ste100 skill that mirrors plan.ts REQUIRED is not part of this repository.)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('the plugin listing (plugin.json) says task, never lot', () => {
  const p = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'))
  assert.doesNotMatch(p.description, /\blots?\b/i)
  for (const v of Object.values(p.userConfig)) assert.doesNotMatch(`${v.title} ${v.description}`, /\blots?\b/i)
})
