// A test's helper: the Board pane shows only its focus block until More (f) is pressed; this opens it if it is not.
type Mounted = { find(q: never): Promise<{ props: Record<string, unknown> } | undefined>; press(q: never): Promise<unknown> }
export async function openMore(pane: Mounted) {
  if ((await pane.find({ key: 'ovp-btn-more' } as never))?.props.label === 'More') await pane.press({ plugin: 'overseer', key: 'ovp-btn-more' } as never)
}
