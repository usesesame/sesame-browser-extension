import type { FillContext } from './fill-state'
import type { FillMatchKind } from '../protocol/native'

export type PublicFillResult =
  | { state: 'filled'; usernameFilled: boolean; passwordFilled: boolean; matchKind: FillMatchKind }
  | { state: 'unavailable'; code: string; lookalike?: string }

export function publicFillResult(context: FillContext): PublicFillResult {
  const phase = context.phase
  if (phase.name === 'complete') {
    return {
      state: 'filled',
      usernameFilled: phase.usernameFilled,
      passwordFilled: phase.passwordFilled,
      matchKind: phase.matchKind,
    }
  }
  if (phase.name === 'failed' && phase.lookalike !== undefined) {
    return { state: 'unavailable', code: phase.code, lookalike: phase.lookalike }
  }
  if (phase.name === 'failed' || phase.name === 'cancelled' || phase.name === 'expired') {
    return { state: 'unavailable', code: phase.code }
  }
  if (phase.name === 'desktop-closed') return { state: 'unavailable', code: 'desktop-unavailable' }
  return { state: 'unavailable', code: 'fill-failed' }
}
