// The types of pushneeds.mjs, for the hooks' parity test (lot 69): the board's needs as the phone pushes them.
export type PushNeed = { key: string; kind: string; id: string; lot?: number; text: string; label?: string; urgent: boolean }
export function pushNeeds(b: {
  needs?: { kind: string; id: string; lot?: number; text?: string; why?: string }[]
  sessions?: { sessionId: string; label: string }[]
  error?: { source: string; text: string }
}): PushNeed[]
