// For tests: a mounted Raster's cells back to text, one line per row (the glyphs, not the colours).
export function rasterText(r: { props: Record<string, unknown> } | undefined): string {
  if (!r) return ''
  const { columns, rows, cells } = r.props as { columns: number; rows: number; cells: string }
  const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
  const v = new DataView(bytes.buffer)
  const out: string[] = []
  for (let y = 0; y < rows; y++) {
    let line = ''
    for (let x = 0; x < columns; x++) line += String.fromCharCode(v.getUint32((y * columns + x) * 12, true))
    out.push(line.trimEnd())
  }
  return out.join('\n')
}
