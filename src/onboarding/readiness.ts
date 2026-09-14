import { isRecord } from '../shared/values'
import {
  CHECKING_PRESENTATION,
  READY_PRESENTATION,
  presentConnection,
  type ConnectionPresentation,
} from '../protocol/connection-presentation'

export type PermissionState = 'granted' | 'not-granted'

export type DesktopState =
  | { status: 'checking' }
  | { status: 'ready'; fillAvailable: boolean }
  | { status: 'locked' }
  | { status: 'blocked'; code: string }

export interface OnboardingView {
  headline: string
  lead: string
  ready: boolean
  connection: ConnectionPresentation
  showPermissionStep: boolean
  showConnectionAction: boolean
}

export function desktopStateFromResponse(response: unknown): DesktopState {
  const value = isRecord(response) ? response : {}
  if (value.state === 'ready') {
    const capabilities = isRecord(value.capabilities) ? value.capabilities : {}
    return { status: 'ready', fillAvailable: capabilities.fillAvailable === true }
  }
  if (value.state === 'locked') return { status: 'locked' }
  const diagnostic = isRecord(value.diagnostic) ? value.diagnostic : {}
  const code = typeof diagnostic.code === 'string'
    ? diagnostic.code
    : typeof value.code === 'string' ? value.code : 'native-runtime-error'
  return { status: 'blocked', code }
}

export function onboardingView(permission: PermissionState, desktop: DesktopState): OnboardingView {
  const permissionGranted = permission === 'granted'
  if (desktop.status === 'checking') {
    return {
      headline: 'Connecting to Sesame',
      lead: 'Checking the private connection on this device.',
      ready: false,
      connection: CHECKING_PRESENTATION,
      showPermissionStep: !permissionGranted,
      showConnectionAction: false,
    }
  }
  if (desktop.status === 'ready' && permissionGranted) {
    return {
      headline: 'Sesame is ready',
      lead: 'Focus a sign-in field on any HTTPS site and the Sesame fill control appears next to it.',
      ready: true,
      connection: READY_PRESENTATION,
      showPermissionStep: false,
      showConnectionAction: false,
    }
  }
  if (desktop.status === 'ready') {
    return {
      headline: 'Sesame is connected',
      lead: 'One permission is left. Allow Sesame on HTTPS sites so the fill control can appear on sign-in and registration fields.',
      ready: false,
      connection: {
        ...READY_PRESENTATION,
        message: desktop.fillAvailable ? '' : 'Page filling is unavailable in this desktop build.',
      },
      showPermissionStep: true,
      showConnectionAction: false,
    }
  }
  return {
    headline: 'Finish setting up Sesame',
    lead: permissionGranted
      ? 'Website access is on. Connect the desktop app to make filling available.'
      : 'Connect the desktop app first, then allow website access.',
    ready: false,
    connection: desktop.status === 'locked'
      ? presentConnection('vault-locked')
      : presentConnection(desktop.code),
    showPermissionStep: !permissionGranted,
    showConnectionAction: true,
  }
}
