import { SESAME_LINKS } from '../shared/links'

export interface HelpLink {
  label: string
  hint: string
  href: string
}

export const HELP_LINKS: HelpLink[] = [
  { label: 'Get support', hint: 'Send a request when something does not work.', href: SESAME_LINKS.support },
  { label: 'Privacy policy', hint: 'What the extension and the website do with data.', href: SESAME_LINKS.privacy },
  { label: 'Security model', hint: 'How Sesame protects your vault and where it stops.', href: SESAME_LINKS.security },
  { label: 'Report a bug', hint: 'Open source on GitHub. Never post passwords.', href: SESAME_LINKS.issues },
  { label: 'Source code', hint: 'Read it, build it or check a release against it.', href: SESAME_LINKS.source },
  { label: 'Sesame website', hint: 'Downloads and the project overview.', href: SESAME_LINKS.website },
]
