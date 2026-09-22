export const DESKTOP_RELEASES_URL = 'https://github.com/usesesame/sesame-desktop/releases/latest'

export type ConnectionAction = 'install' | 'update' | 'open-desktop' | 'reload' | 'retry' | 'none'

export type ConnectionStateName =
  | 'checking'
  | 'missing-host'
  | 'forbidden-host'
  | 'host-stopped'
  | 'desktop-closed'
  | 'locked'
  | 'incompatible'
  | 'timeout'
  | 'failed'
  | 'ready'

export interface ConnectionPresentation {
  state: ConnectionStateName
  title: string
  message: string
  action: ConnectionAction
  actionLabel: string
  canRetry: boolean
}

export const CHECKING_PRESENTATION: ConnectionPresentation = {
  state: 'checking',
  title: 'Finding the desktop app',
  message: 'Checking the private connection on this device.',
  action: 'none',
  actionLabel: '',
  canRetry: false,
}

export const READY_PRESENTATION: ConnectionPresentation = {
  state: 'ready',
  title: 'Connected',
  message: '',
  action: 'none',
  actionLabel: '',
  canRetry: false,
}

const PRESENTATIONS: Record<string, ConnectionPresentation> = {
  'host-not-found': {
    state: 'missing-host',
    title: 'Sesame desktop app not found',
    message: 'Install Sesame for your desktop, then open it. Website access alone does not connect the desktop app.',
    action: 'install',
    actionLabel: 'Get Sesame',
    canRetry: true,
  },
  'host-forbidden': {
    state: 'forbidden-host',
    title: 'Connection needs a refresh',
    message: 'Reload this extension, then restart Sesame and try again.',
    action: 'reload',
    actionLabel: 'Reload extension',
    canRetry: true,
  },
  'host-exited': {
    state: 'host-stopped',
    title: 'Sesame stopped the connection',
    message: 'Open Sesame again. This extension reconnects automatically.',
    action: 'open-desktop',
    actionLabel: 'Open Sesame',
    canRetry: true,
  },
  'host-communication-failed': {
    state: 'host-stopped',
    title: 'Connection was interrupted',
    message: 'Open Sesame again. This extension reconnects automatically.',
    action: 'open-desktop',
    actionLabel: 'Open Sesame',
    canRetry: true,
  },
  'host-disconnected': {
    state: 'host-stopped',
    title: 'Sesame stopped the connection',
    message: 'Open Sesame again. This extension reconnects automatically.',
    action: 'open-desktop',
    actionLabel: 'Open Sesame',
    canRetry: true,
  },
  'protocol-mismatch': {
    state: 'incompatible',
    title: 'Update needed',
    message: 'The desktop app and this extension use different connection versions. Install the latest desktop app.',
    action: 'update',
    actionLabel: 'Update Sesame',
    canRetry: true,
  },
  timeout: {
    state: 'timeout',
    title: 'Sesame is taking too long',
    message: 'Keep the desktop app open, then check again.',
    action: 'retry',
    actionLabel: 'Check again',
    canRetry: true,
  },
  'desktop-unavailable': {
    state: 'desktop-closed',
    title: 'Open Sesame',
    message: 'The browser helper is installed, but the desktop app is not running.',
    action: 'open-desktop',
    actionLabel: 'Open Sesame',
    canRetry: true,
  },
  'vault-locked': {
    state: 'locked',
    title: 'Unlock Sesame',
    message: 'The desktop app is locked. Unlock the vault there, then check again.',
    action: 'open-desktop',
    actionLabel: 'Unlock Sesame',
    canRetry: true,
  },
  'extension-response-timeout': {
    state: 'failed',
    title: 'Extension did not answer',
    message: 'Keep this window open and check again.',
    action: 'retry',
    actionLabel: 'Check again',
    canRetry: true,
  },
  'extension-error': {
    state: 'failed',
    title: 'Extension connection failed',
    message: 'Reload this extension and try again.',
    action: 'retry',
    actionLabel: 'Check again',
    canRetry: true,
  },
  'request-mismatch': {
    state: 'failed',
    title: 'Response could not be verified',
    message: 'Nothing was changed. Check again.',
    action: 'retry',
    actionLabel: 'Check again',
    canRetry: true,
  },
  'unsafe-response': {
    state: 'failed',
    title: 'Response was blocked',
    message: 'Sesame rejected an unexpected response to protect your vault.',
    action: 'retry',
    actionLabel: 'Check again',
    canRetry: true,
  },
  'invalid-response': {
    state: 'failed',
    title: 'Desktop response was not understood',
    message: 'Restart Sesame and try again.',
    action: 'retry',
    actionLabel: 'Check again',
    canRetry: true,
  },
  'host-rejected-request': {
    state: 'failed',
    title: 'Desktop helper declined the check',
    message: 'Update or restart Sesame and try again.',
    action: 'retry',
    actionLabel: 'Check again',
    canRetry: true,
  },
  'host-unavailable': {
    state: 'failed',
    title: 'Desktop helper is unavailable',
    message: 'Open or restart Sesame, then check again.',
    action: 'open-desktop',
    actionLabel: 'Open Sesame',
    canRetry: true,
  },
  'native-runtime-error': {
    state: 'failed',
    title: 'Browser connection failed',
    message: 'Check that Sesame is open, then try again.',
    action: 'retry',
    actionLabel: 'Check again',
    canRetry: true,
  },
}

export function presentConnection(code: string | undefined): ConnectionPresentation {
  if (code === 'ready' || code === 'connected') return READY_PRESENTATION
  return (code ? PRESENTATIONS[code] : undefined) ?? {
    state: 'failed',
    title: 'Connection needs attention',
    message: 'Check that Sesame is open, then try again.',
    action: 'retry',
    actionLabel: 'Check again',
    canRetry: true,
  }
}
