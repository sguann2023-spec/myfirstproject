import Store from 'electron-store'

/** Local-only metadata; never remove a test designation during ordinary edits. */
export class DraftTestRegistry {
  private readonly store = new Store({ name: 'vectcut-draft-tests' })

  private key(draftId: string) {
    // Encode IDs so dots and other user-controlled characters cannot become store paths.
    return `drafts.${Buffer.from(draftId).toString('hex')}`
  }

  markTest(draftId: string): void {
    if (draftId) this.store.set(this.key(draftId), true)
  }

  isTest(draftId: string): boolean {
    return !!draftId && this.store.get(this.key(draftId)) === true
  }
}

export const draftTestRegistry = new DraftTestRegistry()
