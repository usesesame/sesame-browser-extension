// Credentials live only in the state that holds them.
import type { Credential } from '../protocol/native'
import type { PageInspection } from '../protocol/fill'

export type FillPhase =
  | { name: 'disconnected' }
  | { name: 'desktop-closed' }
  | { name: 'locked' }
  | { name: 'ready' }
  | { name: 'inspecting' }
  | { name: 'awaiting-approval'; origin: string; documentToken: string }
  | { name: 'filling'; origin: string; documentToken: string; credential: Credential }
  | { name: 'complete'; usernameFilled: boolean; passwordFilled: boolean }
  | { name: 'cancelled'; code: string }
  | { name: 'expired'; code: string }
  | { name: 'failed'; code: string }

export interface FillContext {
  phase: FillPhase
}

export function initialFillState(): FillContext {
  return { phase: { name: 'disconnected' } }
}

export function transition(state: FillContext, event: FillEvent): FillContext {
  switch (event.type) {
    case 'connection-checked':
      if (!event.ok) return { phase: { name: 'failed', code: event.code } }
      if (!event.desktopAvailable) return { phase: { name: 'desktop-closed' } }
      if (event.locked) return { phase: { name: 'locked' } }
      return { phase: { name: 'ready' } }
    case 'inspection-started':
      return { phase: { name: 'inspecting' } }
    case 'inspection-completed':
      if (!event.inspection.ok) return { phase: { name: 'failed', code: event.inspection.code } }
      if (!event.inspection.hasPasswordField && !event.inspection.hasUsernameField) {
        return { phase: { name: 'failed', code: 'no-fields' } }
      }
      return {
        phase: {
          name: 'awaiting-approval',
          origin: event.inspection.surface.origin,
          documentToken: event.documentToken,
        },
      }
    case 'approval-received':
      if (state.phase.name !== 'awaiting-approval') return state
      return {
        phase: {
          name: 'filling',
          origin: state.phase.origin,
          documentToken: state.phase.documentToken,
          credential: event.credential,
        },
      }
    case 'fill-completed':
      return { phase: { name: 'complete', usernameFilled: event.usernameFilled, passwordFilled: event.passwordFilled } }
    case 'cancelled':
      return { phase: { name: 'cancelled', code: event.code } }
    case 'expired':
      return { phase: { name: 'expired', code: event.code } }
    case 'failed':
      return { phase: { name: 'failed', code: event.code } }
    default:
      return state
  }
}

export type FillEvent =
  | { type: 'connection-checked'; ok: true; desktopAvailable: boolean; locked: boolean; fillAvailable: boolean }
  | { type: 'connection-checked'; ok: false; code: string }
  | { type: 'inspection-started' }
  | { type: 'inspection-completed'; inspection: PageInspection; documentToken: string }
  | { type: 'approval-received'; credential: Credential }
  | { type: 'fill-completed'; usernameFilled: boolean; passwordFilled: boolean }
  | { type: 'cancelled'; code: string }
  | { type: 'expired'; code: string }
  | { type: 'failed'; code: string }

export function isTerminal(phase: FillPhase): boolean {
  return (
    phase.name === 'complete' ||
    phase.name === 'cancelled' ||
    phase.name === 'expired' ||
    phase.name === 'failed'
  )
}

export function isActive(phase: FillPhase): boolean {
  return phase.name === 'inspecting' || phase.name === 'awaiting-approval' || phase.name === 'filling'
}
