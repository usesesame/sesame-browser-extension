import { isRecord } from '../shared/values'
import { presentConnection, type ConnectionPresentation } from '../protocol/connection-presentation'

export type PermissionState = 'granted' | 'not-granted'

export type DesktopState =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'blocked'; code: string }

export interface OnboardingView {
  headline: string
  lead: string
  ready: boolean
  connection: ConnectionPresentation | null
  showPermissionStep: boolean
  showConnectionAction: boolean
}

export function desktopStateFromResponse(response: unknown): DesktopState {
  const value = isRecord(response) ? response : {}
  if (value.state === 'ready') return { status: 'ready' }
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
      connection: null,
      showPermissionStep: !permissionGranted,
      showConnectionAction: false,
    }
  }
  if (desktop.status === 'ready' && permissionGranted) {
    return {
      headline: 'Sesame is ready',
      lead: 'Focus a sign-in field on any HTTPS site and the Sesame fill control appears next to it.',
      ready: true,
      connection: null,
      showPermissionStep: false,
      showConnectionAction: false,
    }
  }
  if (desktop.status === 'ready') {
    return {
      headline: 'Sesame is connected',
      lead: 'One permission is left. Allow Sesame on HTTPS sites so the fill control can appear on sign-in and registration fields.',
      ready: false,
      connection: null,
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
    connection: presentConnection(desktop.code),
    showPermissionStep: !permissionGranted,
    showConnectionAction: true,
  }
}

export type StepState = 'done' | 'current' | 'waiting'

export interface SetupStep {
  title: string
  detail: string
  state: StepState
}

export function setupSteps(permission: PermissionState, desktop: DesktopState): SetupStep[] {
  const connected = desktop.status === 'ready'
  const allowed = permission === 'granted'
  return [
    {
      title: 'Connect the desktop app',
      detail: connected
        ? 'Sesame is open and connected.'
        : desktop.status === 'checking' ? 'Looking for the desktop app.' : 'Install Sesame and open it once.',
      state: connected ? 'done' : 'current',
    },
    {
      title: 'Allow website access',
      detail: allowed ? 'Sesame can appear on HTTPS sign-in fields.' : 'Lets the fill control appear next to sign-in fields.',
      state: allowed ? 'done' : connected ? 'current' : 'waiting',
    },
  ]
}
