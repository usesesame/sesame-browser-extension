import type { Coordinator } from './coordinator'

export async function handleExtensionCommand(command: string, coordinator: Coordinator): Promise<boolean> {
  if (command === 'fill-login') {
    await coordinator.fillActivePage()
    return true
  }
  if (command === 'fill-identity') {
    await coordinator.fillIdentityActivePage()
    return true
  }
  return false
}
