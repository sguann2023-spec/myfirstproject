import { createMigrate } from 'redux-persist'
import { describe, expect, it } from 'vitest'

import { builtinMCPServers } from '../mcp'
import { BuiltinMCPServerNames } from '../../types'

describe('MCP filesystem removal', () => {
  it('does not expose filesystem in the built-in MCP server list', () => {
    const filesystemServer = builtinMCPServers.find((server) => server.name === BuiltinMCPServerNames.filesystem)

    expect(filesystemServer).toBeUndefined()
  })

  describe('migration 208: filesystem cleanup', () => {
    const migrate208 = (state: any) => {
      if (Array.isArray(state.mcp?.servers)) {
        state.mcp.servers = state.mcp.servers.filter((server: any) => server?.name !== '@cherry/filesystem')
      }
      return state
    }

    const migrate = createMigrate({ '208': migrate208 as any })

    it('removes persisted filesystem servers from older state', async () => {
      const state = {
        mcp: {
          servers: [
            {
              id: 'filesystem-server',
              name: '@cherry/filesystem',
              type: 'inMemory',
              args: ['/tmp/workspace'],
              isActive: true
            }
          ]
        },
        _persist: { version: 207, rehydrated: false }
      }

      const migrated: any = await migrate(state, 208)

      expect(migrated.mcp.servers).toEqual([])
    })

    it('preserves other MCP servers during cleanup', async () => {
      const state = {
        mcp: {
          servers: [
            {
              id: 'fetch-server',
              name: '@cherry/fetch',
              type: 'inMemory',
              isActive: true
            }
          ]
        },
        _persist: { version: 207, rehydrated: false }
      }

      const migrated: any = await migrate(state, 208)

      expect(migrated.mcp.servers).toHaveLength(1)
      expect(migrated.mcp.servers[0].name).toBe('@cherry/fetch')
    })
  })
})
