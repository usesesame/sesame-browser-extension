export const SAVE_MESSAGES: Readonly<Record<string, string>> = {
  'approval-declined': 'Nothing was saved. Either the save was declined in Sesame, or this site is on the list of sites Sesame never saves in Settings, Browser.',
  'approval-timeout': 'The save approval expired. Choose Save this login again.',
  'approval-unavailable': 'Sesame could not show the save approval. Bring the desktop app forward and retry.',
  'desktop-unavailable': 'Open Sesame, then choose Save this login again.',
  'host-disconnected': 'The desktop connection closed. Keep Sesame open and retry.',
  'host-exited': 'Sesame stopped the connection. Open it again and retry.',
  'host-forbidden': 'Install the extension from the store listing that Sesame links to, then choose Save this login again.',
  'host-not-found': 'Open Sesame, then choose Save this login again.',
  'invalid-capture': 'Sesame could not verify that form. Nothing was saved.',
  'no-password': 'No new password to read on this page. Fill the form with Sesame first.',
  'protocol-mismatch': 'Update Sesame and the extension, then choose Save this login again.',
  'save-failed': 'Sesame could not save this login.',
  'save-in-progress': 'A save request is already open.',
  'save-not-armed': 'Fill the form with Sesame before saving.',
  'timeout': 'The save did not answer in time. Choose Save this login again.',
  'vault-locked': 'Unlock your vault in the Sesame desktop app, then choose Save this login again.',
}

export function noFillableLoginMessage(hostname: string): string {
  return `Sesame has no login it can fill on ${hostname}. In Sesame, check the login's website and its Browser filling setting.`
}
