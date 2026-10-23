// The phone link (lot 68): `tailscale serve` in front of 127.0.0.1:4318, on the tailnet only (never `tailscale funnel`, never
// 0.0.0.0), and a QR code of https://<name>/?t=<token> drawn in a pane: the terminal only, never a toast, the log, the board
// or a command's text, which the model reads. Pure, so it is tested without a machine.

export const PORT = 4318
export const SERVE = ['tailscale', 'serve', '--bg', `http://127.0.0.1:${PORT}`] // https on 443, the default of tailscale 1.104
export const SERVE_OFF = ['tailscale', 'serve', '--https=443', 'off'] // only this serve: `serve reset` would drop the others too

// What `tailscale status --json` says: logged in (BackendState Running), and this Mac's tailnet name.
export function tailnetOf(json: string): { loggedIn: boolean; name?: string } {
  try {
    const d = JSON.parse(json)
    const name = typeof d.Self?.DNSName === 'string' ? d.Self.DNSName.replace(/\.$/, '') : undefined
    return { loggedIn: d.BackendState === 'Running', ...(name && /\.ts\.net$/.test(name) ? { name } : {}) }
  } catch { return { loggedIn: false } }
}

// The two commands, when Tailscale is missing or logged out.
export const SETUP = { install: ['brew install --cask tailscale', 'tailscale up'], login: ['open -a Tailscale', 'tailscale up'] }

// The QR code's modules (1 dark, 0 light, one row per line, as CoreImage gives them) → terminal lines, two rows per line:
// ▀ the top dark, ▄ the bottom dark, █ both, a space neither; drawn black on white with a 2-module margin.
export function qrLines(matrix: string): string[] {
  const rows = matrix.split('\n').map(r => r.trim()).filter(r => /^[01]+$/.test(r))
  if (!rows.length) return []
  const w = rows[0]!.length + 4, blank = '0'.repeat(w)
  const padded = [blank, blank, ...rows.map(r => `00${r}00`), blank, blank]
  if (padded.length % 2) padded.push(blank)
  const out: string[] = []
  for (let y = 0; y < padded.length; y += 2) {
    const a = padded[y]!, b = padded[y + 1]!
    out.push([...a].map((c, x) => (c === '1' ? (b[x] === '1' ? '█' : '▀') : b[x] === '1' ? '▄' : ' ')).join(''))
  }
  return out
}

// CoreImage's QR generator through JavaScript for Automation: macOS's own, no package. argv[0] is the text; it prints the
// modules as 0/1 lines.
export const QR_SCRIPT = `ObjC.import('CoreImage'); ObjC.import('Foundation'); ObjC.import('AppKit')
function run(argv) {
  const f = $.CIFilter.filterWithName('CIQRCodeGenerator')
  f.setValueForKey($.NSString.alloc.initWithUTF8String(argv[0]).dataUsingEncoding($.NSUTF8StringEncoding), 'inputMessage')
  f.setValueForKey($('M'), 'inputCorrectionLevel')
  const img = f.outputImage, w = img.extent.size.width, h = img.extent.size.height
  const rep = $.NSBitmapImageRep.alloc.initWithCIImage(img)
  const out = []
  for (let y = 0; y < h; y++) { let row = ''; for (let x = 0; x < w; x++) row += rep.colorAtXY(x, y).redComponent < 0.5 ? '1' : '0'; out.push(row) }
  return out.join('\\n')
}`
