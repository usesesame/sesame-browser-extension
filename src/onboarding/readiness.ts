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
  if (value.state === 'desktop-offline') return { status: 'blocked', code: 'desktop-unavailable' }
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
      headline: 'Setting up Sesame',
      lead: 'This takes a few seconds.',
      ready: false,
      connection: null,
      showPermissionStep: !permissionGranted,
      showConnectionAction: false,
    }
  }
  if (desktop.status === 'ready' && permissionGranted) {
    return {
      headline: 'Sesame is ready',
      lead: 'Click a sign-in field on any HTTPS site and choose the Sesame control. You approve each fill in the desktop app and press Sign in yourself.',
      ready: true,
      connection: null,
      showPermissionStep: false,
      showConnectionAction: false,
    }
  }
  if (desktop.status === 'ready') {
    return {
      headline: 'Sesame is connected',
      lead: 'One step is left.',
      ready: false,
      connection: null,
      showPermissionStep: true,
      showConnectionAction: false,
    }
  }
  return {
    headline: 'Set up Sesame',
    lead: permissionGranted
      ? 'Website access is on. Connect the desktop app to start filling.'
      : 'Two steps and Sesame can fill your logins.',
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
      detail: connected ? '' : desktopStepDetail(desktop),
      state: connected ? 'done' : 'current',
    },
    {
      title: 'Allow website access',
      detail: allowed || !connected
        ? ''
        : 'Lets the fill control appear next to sign-in fields. Without it, the popup and the keyboard shortcuts still work.',
      state: allowed ? 'done' : connected ? 'current' : 'waiting',
    },
  ]
}

function desktopStepDetail(desktop: DesktopState): string {
  if (desktop.status === 'checking') return 'Looking for the desktop app.'
  if (desktop.status === 'ready') return ''
  const connection = presentConnection(desktop.code)
  return connection.action === 'install' ? 'Download and install Sesame, then open it once.' : connection.message
}
