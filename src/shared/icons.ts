export type IconName = 'alert' | 'check' | 'refresh'

export const ICON_PATHS: Record<IconName, string[]> = {
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
  check: ['M20 6 9 17l-5-5'],
  refresh: ['M20 6v5h-5', 'M4 18v-5h5', 'M18.7 9A7 7 0 0 0 6.2 6.2L4 8', 'M5.3 15A7 7 0 0 0 17.8 17.8L20 16'],
}
