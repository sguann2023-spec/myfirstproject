/** Electron does not await event listeners; cancel the first quit until cleanup settles. */
export function createDeferredQuit(
  cleanup: () => Promise<void>,
  quit: () => void,
  onError: (error: unknown) => void
): (event: { preventDefault(): void }) => void {
  let complete = false
  let pending: Promise<void> | undefined
  return event => {
    if (complete) return
    event.preventDefault()
    if (pending) return
    pending = Promise.resolve().then(cleanup).catch(onError).finally(() => {
      complete = true
      quit()
    })
  }
}
