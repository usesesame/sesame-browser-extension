import type { FillContext } from './fill-state'

export type PublicFillResult =
  | { state: 'filled'; usernameFilled: boolean; passwordFilled: boolean }
  | { state: 'unavailable'; code: string }

export function publicFillResult(context: FillContext): PublicFillResult {
  const phase = context.phase
  if (phase.name === 'complete') {
    return {
      state: 'filled',
      usernameFilled: phase.usernameFilled,
      passwordFilled: phase.passwordFilled,
    }
  }
  if (phase.name === 'failed' || phase.name === 'cancelled' || phase.name === 'expired') {
    return { state: 'unavailable', code: phase.code }
  }
  if (phase.name === 'desktop-closed') return { state: 'unavailable', code: 'desktop-unavailable' }
  if (phase.name === 'locked') return { state: 'unavailable', code: 'vault-locked' }
  return { state: 'unavailable', code: 'fill-failed' }
}
