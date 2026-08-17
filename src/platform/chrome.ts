export interface Browser {
  runtime: {
    getManifest(): { version: string }
    getURL(path: string): string
    connectNative(name: string): NativePort
    lastError?: { message?: string }
  }
  tabs: {
    query(queryInfo: object): Promise<chrome.tabs.Tab[]>
  }
  scripting: {
    executeScript<T = unknown>(details: ScriptInjectionDetails<T>): Promise<{ result?: T }[]>
  }
}

export type ScriptInjectionDetails<T> = ScriptFunctionInjection<T> | ScriptFileInjection

export interface ScriptFunctionInjection<T> {
  target: { tabId: number; allFrames?: boolean; frameIds?: number[] }
  func: (...args: unknown[]) => T
  args?: unknown[]
}

export interface ScriptFileInjection {
  target: { tabId: number; allFrames?: boolean; frameIds?: number[] }
  files: string[]
}

export interface NativePort {
  name: string
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: {
    addListener(callback: (message: unknown) => void): void
    removeListener(callback: (message: unknown) => void): void
  }
  onDisconnect: {
    addListener(callback: () => void): void
    removeListener(callback: () => void): void
  }
}

export const chromeBrowser: Browser = {
  runtime: {
    getManifest: () => chrome.runtime.getManifest(),
    getURL: (path) => chrome.runtime.getURL(path),
    connectNative: (name) => chrome.runtime.connectNative(name),
    get lastError() {
      return chrome.runtime.lastError
    },
  },
  tabs: {
    query: (queryInfo) => chrome.tabs.query(queryInfo),
  },
  scripting: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    executeScript: (details) => chrome.scripting.executeScript(details as chrome.scripting.ScriptInjection<any, any>),
  } as Browser['scripting'],
}
