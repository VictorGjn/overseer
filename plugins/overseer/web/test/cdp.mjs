// A small browser driver for the board's tests: the system Chrome, headless, driven over the DevTools protocol with Node's global
// WebSocket. Stdlib only. A page can be given a size and a colour scheme, receive keys and clicks, answer a script, and be photographed.
// A missing Chrome fails the tests, unless OVERSEER_NO_BROWSER=1 says the machine has none (then the browser tests are skipped).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function chromePath(env = process.env, exists = existsSync) {
  const found = [env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => p && exists(p))
  return found
}

// Where a browser test reads its options: `skip` is false when Chrome is there; it throws when Chrome is missing and
// OVERSEER_NO_BROWSER is not 1, so a machine without Chrome never reads green by skipping.
export function browserTest(env = process.env, exists = existsSync) {
  if (chromePath(env, exists)) return { skip: false }
  if (env.OVERSEER_NO_BROWSER === '1') return { skip: 'no Chrome (OVERSEER_NO_BROWSER=1)' }
  throw new Error('Chrome not found: install it, set CHROME to its path, or set OVERSEER_NO_BROWSER=1 to skip the browser tests')
}

// Keys by name, as the page sees them in `event.key`; code and keyCode are what Chrome wants to build a real key event.
const KEYS = {
  Enter: { code: 'Enter', vk: 13, text: '\r' }, Escape: { code: 'Escape', vk: 27 }, ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', vk: 39 }, ArrowDown: { code: 'ArrowDown', vk: 40 }, Backspace: { code: 'Backspace', vk: 8 }, Tab: { code: 'Tab', vk: 9 },
}
const CODES = { ',': ['Comma', 188], '.': ['Period', 190], '[': ['BracketLeft', 219], ']': ['BracketRight', 221], ' ': ['Space', 32] }
const keyInfo = key => {
  if (KEYS[key]) return KEYS[key]
  if (CODES[key]) return { code: CODES[key][0], vk: CODES[key][1], text: key }
  if (/^[a-z]$/i.test(key)) return { code: `Key${key.toUpperCase()}`, vk: key.toUpperCase().charCodeAt(0), text: key }
  if (/^[0-9]$/.test(key)) return { code: `Digit${key}`, vk: key.charCodeAt(0), text: key }
  return { code: key, vk: 0, text: key.length === 1 ? key : undefined }
}
const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

export async function launch() {
  const path = chromePath()
  if (!path) throw new Error('Chrome not found')
  const dir = mkdtempSync(join(tmpdir(), 'ov-chrome-'))
  const stray = () => proc.kill() // a test run that ends or dies takes its browser with it
  process.once('exit', stray)
  const proc = spawn(path, ['--headless=new', `--user-data-dir=${dir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-gpu', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const ws = await new Promise((ok, no) => {
    let err = ''
    const timer = setTimeout(() => no(new Error(`Chrome did not start: ${err.slice(-300)}`)), 15000)
    proc.stderr.on('data', d => { err += d; const m = err.match(/DevTools listening on (ws:\S+)/); if (m) { clearTimeout(timer); ok(m[1]) } })
    proc.on('exit', () => no(new Error(`Chrome exited: ${err.slice(-400)}`)))
  })
  const { port } = new URL(ws)
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page')
  const sock = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, no) => { sock.addEventListener('open', ok, { once: true }); sock.addEventListener('error', no, { once: true }) })

  const errors = [], pending = new Map(), events = []
  let id = 0
  sock.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const { ok, no } = pending.get(m.id); pending.delete(m.id); m.error ? no(new Error(`${m.error.message} (${m.id})`)) : ok(m.result) }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    else if (m.method) events.push(m)
  })
  // A call that Chrome never answers ends in an error after 20 s, never in a hang.
  // sessionId: a call to an attached target (a service worker, lot 69), else the page
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const n = ++id, timer = setTimeout(() => { pending.delete(n); no(new Error(`Chrome did not answer ${method} in 20 s`)) }, 20000)
    pending.set(n, { ok: v => { clearTimeout(timer); ok(v) }, no: e => { clearTimeout(timer); no(e) } })
    sock.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  await send('Runtime.enable'); await send('Page.enable')

  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const wait = ms => new Promise(ok => setTimeout(ok, ms))
  const waitFor = async (expr, ms = 3000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await wait(25) }
    throw new Error(`timed out waiting for: ${expr}`)
  }

  const page = {
    errors, events, send, evaluate, wait, waitFor, // events: every DevTools event that is not an exception (Network.responseReceived once Network.enable is sent)
    // width x height, and a colour scheme; animations stop so a picture is the same twice
    async view({ width = 1280, height = 800, dark = false } = {}) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
    },
    async goto(url) {
      await send('Page.navigate', { url })
      await waitFor(`document.readyState === 'complete'`, 10000)
      await evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.append(s) })()`)
      await wait(150) // a few frames after the load
    },
    // a key as a person types it: down, char, up. `mods` is a list of 'meta', 'ctrl', 'alt', 'shift'
    async press(key, mods = []) {
      const k = keyInfo(key), modifiers = mods.reduce((n, m) => n | MODS[m], 0)
      const base = { key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers }
      await send('Input.dispatchKeyEvent', { type: k.text && !modifiers ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text && !modifiers ? { text: k.text } : {}) })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    },
    async type(text) { await send('Input.insertText', { text }) },
    async center(selector) {
      const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
      if (!r) throw new Error(`no element for ${selector}`)
      return r
    },
    async click(selector) {
      const { x, y } = await page.center(selector)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    },
    // a service worker of this origin, by the end of its script URL (lot 69): its own scope for evaluate, and for the events it gets
    async worker(urlEnd) {
      const { targetInfos } = await send('Target.getTargets')
      const t = targetInfos.find(x => x.type === 'service_worker' && x.url.endsWith(urlEnd))
      if (!t) throw new Error(`no service worker for ${urlEnd}`)
      const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
      await send('Runtime.enable', {}, sessionId)
      return { evaluate: async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value } }
    },
    async style(selector, prop) { return evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(prop)})`) },
    // the page as a PNG (a Buffer), at the size of the view
    async screenshot() { return Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64') },
    async close() {
      try { sock.close() } catch {}
      const exited = new Promise(ok => proc.once('exit', ok))
      proc.kill()
      process.off('exit', stray)
      await Promise.race([exited, wait(3000)])
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
  return page
}
