// Walks the light DOM and open shadow roots; closed shadow roots are unreachable by design.
export interface InputScanOptions {
  maxDepth?: number
  maxNodes?: number
}

export interface InputScanResult {
  inputs: HTMLInputElement[]
  shadowRoots: ShadowRoot[]
  truncated: boolean
}

export type ScanRoot = Document | ShadowRoot | Element

export const DEFAULT_MAX_SCAN_DEPTH = 8
export const DEFAULT_MAX_SCAN_NODES = 50_000

interface PendingRoot {
  root: ScanRoot
  depth: number
}

export function collectInputs(root: ScanRoot, options: InputScanOptions = {}): InputScanResult {
  const maxDepth = scanLimit(options.maxDepth, DEFAULT_MAX_SCAN_DEPTH)
  const maxNodes = scanLimit(options.maxNodes, DEFAULT_MAX_SCAN_NODES)
  const inputs: HTMLInputElement[] = []
  const shadowRoots: ShadowRoot[] = []
  const pending: PendingRoot[] = [{ root, depth: 0 }]
  let visited = 0

  while (pending.length > 0) {
    const current = pending.shift()!
    const walkerDocument = current.root.ownerDocument ?? document
    const walker = walkerDocument.createTreeWalker(current.root, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (visited >= maxNodes) return { inputs, shadowRoots, truncated: true }
      visited += 1
      if (node instanceof HTMLInputElement) inputs.push(node)
      const shadowRoot = (node as Element).shadowRoot
      if (!shadowRoot) continue
      if (current.depth >= maxDepth) return { inputs, shadowRoots, truncated: true }
      shadowRoots.push(shadowRoot)
      pending.push({ root: shadowRoot, depth: current.depth + 1 })
    }
  }

  return { inputs, shadowRoots, truncated: false }
}

export function collectInputsOfType(
  root: ScanRoot,
  type: string,
  options: InputScanOptions = {},
): InputScanResult {
  const scan = collectInputs(root, options)
  const wanted = type.toLowerCase()
  return { ...scan, inputs: scan.inputs.filter((input) => input.type.toLowerCase() === wanted) }
}

export function labelsForInput(input: HTMLInputElement): HTMLLabelElement[] {
  const labels: HTMLLabelElement[] = []
  const root = queryRoot(input.getRootNode())
  if (input.id && root) {
    for (const label of root.querySelectorAll<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`)) {
      labels.push(label)
    }
  }
  const wrapping = input.closest('label')
  if (wrapping && !labels.includes(wrapping)) labels.push(wrapping)
  return labels
}

function queryRoot(root: Node): ParentNode | null {
  return typeof (root as ParentNode).querySelectorAll === 'function' ? (root as ParentNode) : null
}

export function eventTargetInput(event: Event): HTMLInputElement | null {
  const target = event.composedPath()[0] ?? event.target
  return target instanceof HTMLInputElement ? target : null
}

function scanLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}
