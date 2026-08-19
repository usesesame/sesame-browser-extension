import { createHash } from 'node:crypto'

const REQUIRED_PERMISSIONS = ['activeTab', 'nativeMessaging', 'scripting', 'storage']
const REQUIRED_OPTIONAL_HOST_PERMISSIONS = ['https://*/*']
// `host_permissions` stays in the integration build only.
const FORBIDDEN_KEYS = ['host_permissions', 'content_scripts', 'web_accessible_resources']

export function chromiumExtensionId(publicKey) {
  const digest = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest().subarray(0, 16)
  return [...digest].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('')
}

export function verifyStoreManifest(browser, manifest, version, identity) {
  const fail = (message) => {
    throw new Error(`${browser} package: ${message}`)
  }
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3.')
  if (manifest.version !== version) {
    fail(`manifest version ${manifest.version} does not match package version ${version}. Run npm run version:sync.`)
  }
  for (const key of FORBIDDEN_KEYS) {
    if (key in manifest) fail(`${key} must not reach a store package.`)
  }
  if (JSON.stringify(manifest.permissions) !== JSON.stringify(REQUIRED_PERMISSIONS)) {
    fail(`permissions must be exactly ${REQUIRED_PERMISSIONS.join(', ')}.`)
  }
  if (JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(REQUIRED_OPTIONAL_HOST_PERMISSIONS)) {
    fail(`optional_host_permissions must be exactly ${REQUIRED_OPTIONAL_HOST_PERMISSIONS.join(', ')}.`)
  }
  // The native host pins exact extension identities with no wildcards.
  // Firefox is pinned by gecko id; Chromium by the id derived from the packed key.
  if (browser === 'firefox') {
    if ('key' in manifest) fail('a Chromium packing key must not reach the Firefox package.')
    const gecko = manifest.browser_specific_settings?.gecko?.id
    if (!gecko) fail('browser_specific_settings.gecko.id is missing.')
    if (gecko !== identity.firefox_extension_id) {
      fail(`gecko id ${gecko} is not the host-pinned id ${identity.firefox_extension_id}.`)
    }
    if (!identity.allowed_extensions.includes(gecko)) {
      fail(`the pinned native-host contract does not allow ${gecko}.`)
    }
    return gecko
  }
  const derived = chromiumExtensionId(manifest.key)
  if (derived !== identity.official_extension_id) {
    fail(`derived extension id ${derived} is not the host-pinned id ${identity.official_extension_id}.`)
  }
  if (!identity.allowed_origins.includes(`chrome-extension://${derived}/`)) {
    fail(`the pinned native-host contract does not allow chrome-extension://${derived}/.`)
  }
  return derived
}
