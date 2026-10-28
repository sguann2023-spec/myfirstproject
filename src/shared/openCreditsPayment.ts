import { tokenStore } from '../auth/tokenStore'
import { electronStore } from './electronStore'

const PAYMENT_URL = 'https://www.vectcut.com/redeem/payment'

/** Shared by the sidebar and error recovery; credentials stay in the URL fragment. */
export async function openCreditsPayment(onRefreshCredits?: () => unknown): Promise<void> {
  if (onRefreshCredits) {
    void Promise.resolve().then(onRefreshCredits).catch(() => {})
  }
  let paymentUrl = PAYMENT_URL
  try {
    const token = await tokenStore.ensureValidAccessToken()
    if (typeof token === 'string' && token.trim()) {
      const user = electronStore.get('user') || {}
      const url = new URL(PAYMENT_URL)
      const hash = new URLSearchParams({ jwt: token.trim() })
      for (const key of ['name', 'avatar', 'email']) {
        if (typeof user[key] === 'string' && user[key].trim()) hash.set(key, user[key].trim())
      }
      url.hash = hash.toString()
      paymentUrl = url.toString()
    }
  } catch {}

  try {
    if (window.api?.openInternalWebsite) {
      await window.api.openInternalWebsite(paymentUrl)
      return
    }
  } catch {}
  try {
    const { shell } = window.require('electron')
    if (shell?.openExternal) {
      await shell.openExternal(paymentUrl)
      return
    }
  } catch {}
  window.open(paymentUrl, '_blank', 'noopener,noreferrer')
}
