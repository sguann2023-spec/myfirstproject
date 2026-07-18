import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'

import diff from 'fast-diff'

import { agentFileChangeRepository } from '../../../database/repositories/agentFileChangeRepository'
import type { AgentFileChange } from './types'

export interface RecordFileChangeInput extends Omit<AgentFileChange, 'id' | 'createdAt'> {}

export interface FileChangeJournalService {
  record(input: RecordFileChangeInput): Promise<AgentFileChange>
  listByTurn(turnId: string): Promise<AgentFileChange[]>
  readSnapshot(filePath?: string): Promise<{ content?: string; hash?: string; exists: boolean }>
  buildPatch(beforeSnapshot?: string, afterSnapshot?: string): string | undefined
}

export class FileChangeJournalServiceImpl implements FileChangeJournalService {
  async record(input: RecordFileChangeInput): Promise<AgentFileChange> {
    return agentFileChangeRepository.save({
      id: `filechange_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...input
    })
  }

  async listByTurn(turnId: string): Promise<AgentFileChange[]> {
    return agentFileChangeRepository.listByTurnId(turnId)
  }

  async readSnapshot(filePath?: string): Promise<{ content?: string; hash?: string; exists: boolean }> {
    const resolvedPath = String(filePath || '').trim()
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return { exists: false }
    }

    const stat = await fs.promises.stat(resolvedPath)
    if (!stat.isFile()) {
      return { exists: false }
    }

    const content = await fs.promises.readFile(resolvedPath, 'utf8')
    return {
      exists: true,
      content,
      hash: createHash('sha256').update(content).digest('hex')
    }
  }

  buildPatch(beforeSnapshot?: string, afterSnapshot?: string): string | undefined {
    const before = beforeSnapshot ?? ''
    const after = afterSnapshot ?? ''
    if (before === after) {
      return undefined
    }

    const hunks = diff(before, after)
      .map(([op, text]) => {
        if (!text) {
          return null
        }
        const normalized = text.replace(/\r\n/g, '\n')
        if (op === 0) {
          return ` ${normalized}`
        }
        if (op === -1) {
          return `-${normalized}`
        }
        return `+${normalized}`
      })
      .filter((item): item is string => Boolean(item))
      .join('')
      .split('\n')
      .slice(0, 400)
      .join('\n')

    return hunks || undefined
  }
}

export const fileChangeJournalService = new FileChangeJournalServiceImpl()
