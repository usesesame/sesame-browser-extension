import { writable } from 'svelte/store'

export type PopupPhase =
  | { name: 'initial' }
  | { name: 'checking' }
  | { name: 'unavailable'; code: string; title: string; message: string }
  | { name: 'desktop-offline'; title: string; message: string }
  | { name: 'locked'; title: string; message: string }
  | { name: 'ready'; fillAvailable: boolean; pageFillable: boolean }
  | { name: 'filling' }
  | { name: 'filled'; usernameFilled: boolean; passwordFilled: boolean }
  | { name: 'failed'; code: string; title: string; message: string }

export interface PopupState {
  phase: PopupPhase
  diagnostic?: Record<string, unknown>
  pageDiagnostic?: PageDiagnostic
  hostname: string
}

export interface PageDiagnostic {
  code: string
  hasUsernameField?: boolean
  hasPasswordField?: boolean
  surfaceKind?: string
}

export const popupState = writable<PopupState>({
  phase: { name: 'initial' },
  hostname: '',
})

export function setChecking() {
  popupState.update((s) => ({ ...s, phase: { name: 'checking' } }))
}

export function setUnavailable(code: string, title: string, message: string, diagnostic?: Record<string, unknown>) {
  popupState.update((s) => ({
    ...s,
    phase: { name: 'unavailable', code, title, message },
    diagnostic,
  }))
}

export function setDesktopOffline(title: string, message: string) {
  popupState.update((s) => ({ ...s, phase: { name: 'desktop-offline', title, message } }))
}

export function setLocked(title: string, message: string) {
  popupState.update((s) => ({ ...s, phase: { name: 'locked', title, message } }))
}

export function setReady(fillAvailable: boolean, pageFillable: boolean) {
  popupState.update((s) => ({ ...s, phase: { name: 'ready', fillAvailable, pageFillable } }))
}

export function setFilling() {
  popupState.update((s) => ({ ...s, phase: { name: 'filling' } }))
}

export function setFilled(usernameFilled: boolean, passwordFilled: boolean) {
  popupState.update((s) => ({ ...s, phase: { name: 'filled', usernameFilled, passwordFilled } }))
}

export function setFailed(code: string, title: string, message: string) {
  popupState.update((s) => ({ ...s, phase: { name: 'failed', code, title, message } }))
}

export function setHostname(hostname: string) {
  popupState.update((s) => ({ ...s, hostname }))
}

export function setPageDiagnostic(pageDiagnostic: PageDiagnostic) {
  popupState.update((s) => ({ ...s, pageDiagnostic }))
}

export function clearPageDiagnostic() {
  popupState.update((s) => ({ ...s, pageDiagnostic: undefined }))
}
