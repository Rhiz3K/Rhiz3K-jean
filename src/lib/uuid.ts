/**
 * Generate an RFC 4122 version 4 UUID using Web Crypto.
 * This avoids relying on crypto.randomUUID(), which is not
 * consistently available across all webview runtimes.
 */
export function generateId(): string {
  if (
    !globalThis.crypto ||
    typeof globalThis.crypto.getRandomValues !== 'function'
  ) {
    throw new Error('Web Crypto API is unavailable: cannot generate UUID')
  }

  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  const view = new DataView(bytes.buffer)

  // RFC 4122 v4: set version and variant bits.
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40)
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80)

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
}
