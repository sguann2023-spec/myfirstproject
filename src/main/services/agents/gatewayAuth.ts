/** Login credentials may only be used with the HTTPS VectCut gateway. */
export function isVectcutGatewayUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'open.vectcut.com'
  } catch {
    return false
  }
}
