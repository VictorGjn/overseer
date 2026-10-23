import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { qrLines, SERVE, SERVE_OFF, tailnetOf } from './phone.ts'

// Lot 68: /oversee phone. CAUTION: the board can approve workflows: tailnet only, and the token goes to a pane only.
const TOKEN = 'ab'.repeat(32), NAME = 'my-mac.tail1234.ts.net'
const STATUS = (state: string) => JSON.stringify({ BackendState: state, Self: { DNSName: `${NAME}.`, HostName: 'Victors-Mac' } })

test('the tailnet name and the login from `tailscale status --json`; serve on 127.0.0.1 only, never funnel', () => {
  expect(tailnetOf(STATUS('Running'))).toEqual({ loggedIn: true, name: NAME })
  expect(tailnetOf(STATUS('NeedsLogin'))).toEqual({ loggedIn: false, name: NAME })
  expect(tailnetOf('{')).toEqual({ loggedIn: false })
  expect(tailnetOf(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'example.com.' } }))).toEqual({ loggedIn: true }) // not a tailnet name
  expect(SERVE).toEqual(['tailscale', 'serve', '--bg', 'http://127.0.0.1:4318'])
  expect(SERVE_OFF).toEqual(['tailscale', 'serve', '--https=443', 'off'])
  expect([...SERVE, ...SERVE_OFF].join(' ')).not.toMatch(/funnel|0\.0\.0\.0/)
})

test('the QR modules become half-block lines, two rows a line, with a margin', () => {
  expect(qrLines('101\n011\n110')).toEqual(['       ', '  ▀▄█  ', '  ▀▀   ', '       ']) // rows: margin, margin, 101, 011, 110, margin, margin (+1)
  expect(qrLines('error: no CoreImage')).toEqual([])
})

function setup(on: On, o: { installed?: boolean; state?: string; serve?: number; qr?: string; board?: string } = {}) {
  let board: string | undefined = o.board ?? '9.9.9' // the version /version answers; a started server answers the plugin's own
  const files: Record<string, string> = { '/h/.claude/overseer/web.json': JSON.stringify({ port: 4318, token: TOKEN, pid: 1 }) }
  const runs: string[][] = [], toasts: string[] = []
  const store: Record<string, unknown> = {}
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: Date.parse('2026-10-23T08:00:00Z') })
  on('store.get', (_$, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.set', (_$, e) => { store[(e as { key: string }).key] = (e as { value: unknown }).value; return { value: undefined } as never })
  on('store.keys', () => ({ value: Object.keys(store) }) as never)
  on('store.delete', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('ui.toast', (_$, e) => { toasts.push(JSON.stringify(e)); return { value: undefined } as never })
  const opened: string[] = []
  on('ui.open', (_$, e) => { opened.push((e as { id: string }).id); return { value: { isPlaced: true } } as never })
  on('http.fetch', () => (board ? { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ version: board, dir: '/x/overseer/web', pid: 4242 }) } } : { deny: 'ECONNREFUSED' }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path.endsWith('/.claude-plugin/plugin.json') ? { value: '{"version":"0.4.1"}' } : (e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    runs.push(c)
    const out = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr } }) as never
    if (c[0] === 'tailscale' && c[1] === 'version') return o.installed === false ? out('', 127, 'not found') : out('1.104.2')
    if (c[0] === 'tailscale' && c[1] === 'status') return out(STATUS(o.state ?? 'Running'))
    if (c[0] === 'tailscale' && c[1] === 'serve') return out('', o.serve ?? 0, o.serve ? 'serve config denied' : '')
    if (c[0] === 'node' && c[1] === '-e') { board = '0.4.1'; return out('') }
    if (c[0] === 'kill') { board = undefined; return out('') }
    if (c[0] === 'osascript') return out(o.qr ?? '0000000\n0111110\n0100010\n0111110\n0000000')
    return out('')
  })
  return { files, runs, toasts, opened, store, board: () => board }
}
const phone = async ($: Engine, args = 'phone') => ((await $.command.run({ command: 'oversee', args } as never)) as unknown as { text: string }).text

test('/oversee phone: serve in front of 127.0.0.1:4318, store the name, and the QR code of https://<name>/?t=<token> in the pane only', async ($, on) => {
  const s = setup(on)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  const text = await phone($)
  expect(s.runs.find(c => c[0] === 'tailscale' && c[1] === 'serve')).toEqual(SERVE)
  expect(JSON.parse(s.files['/h/.claude/overseer/web.json']!)).toEqual({ port: 4318, token: TOKEN, pid: 1, host: NAME })
  expect(s.runs.find(c => c[0] === 'osascript')!.at(-1)).toBe(`https://${NAME}/?t=${TOKEN}`) // what the QR code holds
  expect(s.opened).toContain('overseer-phone')
  expect(text).toContain(`https://${NAME}`)
  expect(text).not.toContain(TOKEN) // the command's text reaches the model
  const log = await phone($, 'log')
  for (const t of [text, log, s.toasts.join('\n'), JSON.stringify(s.store)]) expect(t).not.toContain(TOKEN) // no toast, no log, no store or board
  const pane = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer-phone', props: { title: 'phone', isFocused: true, bodyColumns: 60, placement: 'dock' }, viewport: { columns: 64, rows: 40 } } as never)
  const box = (await pane.find({ type: 'Box' } as never)) as unknown as { text: string; children: { props: Record<string, unknown>; children: string[] }[] }
  expect(box.children[1]!.props).toMatchObject({ color: 'black', backgroundColor: 'white' }) // black on white, whatever the terminal theme
  expect(box.children[1]!.children[0]).toBe('   ▄▄▄▄▄   ') // the drawn modules
  expect(box.text).toContain(`https://${NAME} · tailnet only`)
  expect(box.text).not.toContain(TOKEN) // the pane draws the code, not the link
  await pane.unmount()
})

test('/oversee phone without Tailscale, or logged out, prints the two commands to run and serves nothing', async ($, on) => {
  const s = setup(on, { installed: false })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  expect(await phone($)).toBe('📱 Tailscale is not installed. Run:\n  brew install --cask tailscale\n  tailscale up\nthen /oversee phone again.')
  expect(s.runs.some(c => c[1] === 'serve')).toBe(false)
})

test('/oversee phone logged out prints how to log in; serve refused says why; neither stores a name', async ($, on) => {
  const s = setup(on, { state: 'NeedsLogin' })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  expect(await phone($)).toBe('📱 Tailscale is not logged in. Run:\n  open -a Tailscale\n  tailscale up\nthen /oversee phone again.')
  expect(JSON.parse(s.files['/h/.claude/overseer/web.json']!).host).toBeUndefined()
})

test('/oversee phone off stops the serve and forgets the name', async ($, on) => {
  const s = setup(on)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await phone($)
  const text = await phone($, 'phone off')
  expect(s.runs.find(c => c[1] === 'serve' && c.includes('off'))).toEqual(SERVE_OFF)
  expect(JSON.parse(s.files['/h/.claude/overseer/web.json']!)).toEqual({ port: 4318, token: TOKEN, pid: 1 })
  expect(text).toMatch(/^📱 Phone link off: tailscale serve stopped/)
  const pane = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer-phone', props: { title: 'phone', isFocused: true, bodyColumns: 60, placement: 'dock' }, viewport: { columns: 64, rows: 40 } } as never)
  expect(((await pane.find({ type: 'Box' } as never)) as unknown as { text: string }).text).toBe('No phone link here: run /oversee phone.')
  await pane.unmount()
})

// task 76: /oversee phone runs the same server check as a pass: an older board is replaced before the serve starts
test('/oversee phone with a 0.3.0 board: the board is replaced first (even right after a pass tried), then served, and the QR code is printed', async ($, on) => {
  const s = setup(on, { board: '0.3.0' })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  const text = await phone($)
  const at = (f: (c: string[]) => boolean) => s.runs.findIndex(f)
  expect(s.board()).toMatch(/^0\.4\./)
  expect(s.runs.filter(c => c[0] === 'kill')).toEqual([['kill', '4242']])
  expect(at(c => c[0] === 'node' && c[1] === '-e')).toBeGreaterThan(-1)
  expect(at(c => c[0] === 'node' && c[1] === '-e')).toBeLessThan(at(c => c[0] === 'tailscale' && c[1] === 'serve')) // replaced before the serve starts
  expect(s.runs.some(c => c[0] === 'osascript')).toBe(true)
  expect(text).toContain(`https://${NAME}`)
})
