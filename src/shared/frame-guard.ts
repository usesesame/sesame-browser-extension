export const FRAMED_PAGE_MESSAGE =
  'Sesame does not run inside a frame. Open this page directly.'

export function requireTopLevelFrame(
  documentRef: Document = document,
  windowRef: Window = window,
): boolean {
  if (windowRef.top === windowRef) return true
  const notice = documentRef.createElement('p')
  notice.setAttribute('role', 'alert')
  notice.style.cssText =
    'margin:24px;font:16px/1.5 system-ui,sans-serif;color:#273329;background:#fffefa'
  notice.textContent = FRAMED_PAGE_MESSAGE
  documentRef.body.replaceChildren(notice)
  return false
}
