import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'

const { storeDir } = vi.hoisted(() => ({ storeDir: { value: '' } }))

// electron-store is CommonJS: intercept only its Electron host dependency,
// retaining the actual electron-store/Conf disk persistence implementation.
vi.mock('electron-store', () => {
  const require = createRequire(import.meta.url)
  const Module = require('node:module')
  const originalLoad = Module._load
  storeDir.value = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-test-registry-'))
  Module._load = function (id: string, ...args: unknown[]) {
    if (id === 'electron') return {
      app: { getPath: () => storeDir.value, getVersion: () => '1.0.0' },
      ipcMain: { on: () => {} }
    }
    return originalLoad.call(this, id, ...args)
  }
  try {
    return { default: require('electron-store') }
  } finally {
    Module._load = originalLoad
  }
})

import { DraftTestRegistry } from '../draft-test-registry'

afterAll(() => fs.rmSync(storeDir.value, { recursive: true, force: true }))

describe('DraftTestRegistry real disk persistence', () => {
  it('shares test IDs across instances and module reloads without clearing earlier IDs', async () => {
    const first = new DraftTestRegistry()
    const second = new DraftTestRegistry()
    expect(first.isTest('ordinary')).toBe(false)
    first.markTest('draft.with.dots/中文')
    expect(second.isTest('draft.with.dots/中文')).toBe(true)
    second.markTest('another')
    expect(first.isTest('another')).toBe(true)
    vi.resetModules()
    const reloaded = await import('../draft-test-registry')
    expect(reloaded.draftTestRegistry.isTest('draft.with.dots/中文')).toBe(true)
    expect(reloaded.draftTestRegistry.isTest('another')).toBe(true)
    expect(reloaded.draftTestRegistry.isTest('ordinary')).toBe(false)
    expect(fs.readFileSync(path.join(storeDir.value, 'vectcut-draft-tests.json'), 'utf8')).toContain('true')
  })

  it('ignores empty IDs', () => {
    const registry = new DraftTestRegistry()
    registry.markTest('')
    expect(registry.isTest('')).toBe(false)
  })
})
