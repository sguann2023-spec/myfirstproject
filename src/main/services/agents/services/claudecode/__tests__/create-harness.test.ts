import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { net } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import * as agentCore from '@earendil-works/pi-agent-core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let mockIsWin = false
const logMocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  app: { getPath: vi.fn(() => os.tmpdir()) }
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: { getMainWindow: vi.fn() }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => logMocks
  }
}))

vi.mock('@main/constant', () => ({
  get isWin() {
    return mockIsWin
  }
}))

vi.mock('@main/utils/process', () => ({
  findGitBash: vi.fn(),
  validateGitBashPath: vi.fn()
}))

vi.mock('@shared/sessionPayloadLimits', () => {
  const textEncoder = new TextEncoder()
  const getUtf8ByteLength = (value: string) => textEncoder.encode(value).length
  const MAX_INLINE_TOOL_PAYLOAD_BYTES = 16 * 1024

  return {
    limitInlineToolPayload(value: unknown, options: { label?: string } = {}) {
      const label = options.label || '工具回包'
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      if (getUtf8ByteLength(text) <= MAX_INLINE_TOOL_PAYLOAD_BYTES) {
        return value
      }
      const notice = `\n\n[${label} 已截断]`
      const maxBodyBytes = MAX_INLINE_TOOL_PAYLOAD_BYTES - getUtf8ByteLength(notice)
      let best = ''
      let low = 0
      let high = text.length
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const candidate = text.slice(0, mid)
        if (getUtf8ByteLength(candidate) <= maxBodyBytes) {
          best = candidate
          low = mid + 1
        } else {
          high = mid - 1
        }
      }
      return `${best}${notice}`
    }
  }
})

import { findGitBash, validateGitBashPath } from '@main/utils/process'

import { normalizeOpenAiMessages, wrapPiApiModuleWithLogging, buildMcpTools, buildCodemodeTool, buildLimitedPiToolPayload, buildPiBashTool, resolveShellExecutable, resolveReadImageAsContentInput } from '../harness/create-harness'

const textEncoder = new TextEncoder()
const getUtf8ByteLength = (value: string) => textEncoder.encode(value).length
const MAX_INLINE_TOOL_PAYLOAD_BYTES = 16 * 1024
const mockedFindGitBash = vi.mocked(findGitBash)
const mockedValidateGitBashPath = vi.mocked(validateGitBashPath)
let agentNode: Parameters<typeof buildPiBashTool>[0]['agentNode']

beforeAll(async () => {
  const nodePackage = '@earendil-works/pi-agent-core/node'
  agentNode = await import(nodePackage)
})

beforeEach(() => {
  mockIsWin = false
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('OpenAI tool message normalization', () => {
  const call = (...ids: string[]) => ({ role: 'assistant', content: null, tool_calls: ids.map(id => ({ id, type: 'function', function: { name: 'test', arguments: '{}' } })) })
  const tool = (id: string, content: unknown = 'ok') => ({ role: 'tool', tool_call_id: id, content })
  const user = { role: 'user', content: 'continue' }
  const missing = (id: string) => expect.objectContaining({
    role: 'tool', tool_call_id: id, content: expect.stringMatching(/failed or was interrupted.*no result.*do not assume/)
  })

  it('fills missing results before the next turn and at end of history', () => {
    expect(normalizeOpenAiMessages([call('A'), user, call('B')]))
      .toEqual([call('A'), missing('A'), user, call('B'), missing('B')])
  })

  it('pairs parallel results by ID and fills only missing results', () => {
    expect(normalizeOpenAiMessages([call('A', 'B', 'C'), tool('C'), tool('A'), user]))
      .toEqual([call('A', 'B', 'C'), tool('C'), tool('A'), missing('B'), user])
  })

  it.each(['', 'Error: tool execution failed', null, [{ type: 'text', text: 'failed' }]])('preserves real empty or failed content %j', content => {
    const messages = [call('A'), tool('A', content)]
    expect(normalizeOpenAiMessages(messages)).toEqual(messages)
  })

  it('filters orphan and duplicate results without changing non-tool messages', () => {
    expect(normalizeOpenAiMessages([tool('orphan'), user, call('A'), tool('wrong'), tool('A'), tool('A', 'duplicate')]))
      .toEqual([user, call('A'), tool('A')])
  })

  it('drops late results after a user turn and never borrows across reused IDs', () => {
    expect(normalizeOpenAiMessages([call('A'), user, tool('A', 'late'), call('A'), tool('A', 'new')]))
      .toEqual([call('A'), missing('A'), user, call('A'), tool('A', 'new')])
    expect(normalizeOpenAiMessages([call('A'), user, call('A'), tool('A')]))
      .toEqual([call('A'), missing('A'), user, call('A'), tool('A')])
  })

  it('does not mutate frozen input and is idempotent', () => {
    const messages = [call('A', 'B'), tool('B'), user, tool('A', 'late')]
    const snapshot = structuredClone(messages)
    const freeze = (value: any): any => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
      }
      return value
    }
    freeze(messages)
    const result = normalizeOpenAiMessages(messages)
    expect(messages).toEqual(snapshot)
    expect(normalizeOpenAiMessages(result)).toEqual(result)
    expect(result).not.toBe(messages)
  })

  it.each(['stream', 'streamSimple'] as const)('%s normalizes callback replacements and original payloads without tools', async method => {
    const underlying = vi.fn((_model, _context, options) => options)
    const wrapper = wrapPiApiModuleWithLogging({
      apiModule: { stream: underlying, streamSimple: underlying } as any,
      invokeContext: { runtime: { traceId: 'test' }, projection: {} } as any,
      providerApiType: 'openai-completions'
    })
    for (const mode of ['replacement', 'mutated', 'absent', 'null'] as const) {
      const originalMessages = [call('A'), user]
      const original: any = { messages: originalMessages }
      const replacement: any = { messages: [call('B')], tools: [{}], thinking: {}, reasoning_effort: 'high' }
      const callback = vi.fn((payload) => {
        expect(payload).toBe(original)
        if (mode === 'mutated') payload.messages = [call('B')]
        return mode === 'replacement' ? replacement : mode === 'null' ? null : undefined
      })
      const options = (wrapper[method] as any)({}, {}, mode === 'absent' ? {} : { onPayload: callback })
      const returned = await options.onPayload(original, { id: 'model' })
      const effective = returned ?? original
      expect(effective.messages).toEqual(mode === 'replacement' || mode === 'mutated'
        ? [call('B'), missing('B')]
        : [call('A'), missing('A'), user])
      expect(originalMessages).toEqual([call('A'), user])
      if (mode === 'replacement') {
        expect(returned).toBe(replacement)
        expect(effective.tool_choice).toBe('auto')
        expect(effective.thinking).toBeUndefined()
        expect(effective.reasoning_effort).toBeUndefined()
      }
    }
  })

  it.each(['stream', 'streamSimple'] as const)('%s stays silent on success, warns on HTTP errors, and forwards callbacks', async method => {
    const underlying = vi.fn((_model, _context, options) => options)
    const wrapper = wrapPiApiModuleWithLogging({
      apiModule: { stream: underlying, streamSimple: underlying } as any,
      invokeContext: { runtime: { traceId: 'test' }, projection: { topicId: 'topic' } } as any,
      providerApiType: 'openai-completions'
    })
    const onResponse = vi.fn(async () => {})
    const model = { id: 'model', baseUrl: 'https://example.com/v1' }
    const options = (wrapper[method] as any)(model, {}, { onResponse })
    await options.onPayload({ messages: [] }, model)
    const success = { status: 200 }
    await options.onResponse(success, model)
    expect(logMocks.info).not.toHaveBeenCalled()
    expect(logMocks.warn).not.toHaveBeenCalled()
    expect(onResponse).toHaveBeenLastCalledWith(success, model)

    const failure = { status: 503 }
    await options.onResponse(failure, model)
    expect(logMocks.warn).toHaveBeenCalledExactlyOnceWith(
      '[AgentCore] pi provider response error',
      expect.objectContaining({ traceId: 'test', topicId: 'topic', status: 503, method })
    )
    expect(onResponse).toHaveBeenLastCalledWith(failure, model)
    expect(onResponse).toHaveBeenCalledTimes(2)
    expect(logMocks.info).not.toHaveBeenCalled()
  })

  it.each(['stream', 'streamSimple'] as const)('%s preserves Anthropic messages and existing parameter semantics', async method => {
    const underlying = vi.fn((_model, _context, options) => options)
    const wrapper = wrapPiApiModuleWithLogging({
      apiModule: { stream: underlying, streamSimple: underlying } as any,
      invokeContext: { runtime: {}, projection: {} } as any,
      providerApiType: 'anthropic-messages'
    })
    const messages = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'A' }] }]
    const payload: any = { messages, tools: [{}], tool_choice: { type: 'any' }, enable_thinking: true, thinking: {}, reasoning: {}, reasoning_effort: 'high', chat_template_kwargs: {} }
    const options = (wrapper[method] as any)({}, {}, {})
    await options.onPayload(payload, {})
    expect(payload.messages).toBe(messages)
    expect(payload.tool_choice).toEqual({ type: 'any' })
    for (const key of ['enable_thinking', 'thinking', 'reasoning', 'reasoning_effort', 'chat_template_kwargs']) {
      expect(payload).not.toHaveProperty(key)
    }
  })
})

describe('ReadImageAsContent input validation', () => {
  const video = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
  const resolve = (source: string) => resolveReadImageAsContentInput({ source, cwd: process.cwd() })
  const png = () => sharp({
    create: { width: 2, height: 2, channels: 3, background: '#ffffff' }
  }).png().toBuffer()

  it('rejects local MP4 content even when named PNG', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'read-image-test-'))
    try {
      for (const name of ['video.mp4', 'fake.png']) {
        const file = path.join(dir, name)
        await writeFile(file, video)
        await expect(resolve(file)).rejects.toThrow('requires a valid image')
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('detects the real format of a local image without changing its bytes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'read-image-test-'))
    try {
      const buffer = await png()
      const file = path.join(dir, 'image.jpg')
      await writeFile(file, buffer)
      const result = await resolve(file)
      expect(result.mimeType).toBe('image/png')
      expect(Buffer.from(result.base64, 'base64')).toEqual(buffer)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects remote video even when the server declares image/png', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(new Uint8Array(video), {
      headers: { 'content-type': 'image/png' }
    }))
    await expect(resolve('https://example.test/fake.png')).rejects.toThrow('requires a valid image')
  })

  it('accepts real remote images regardless of content-type or URL extension', async () => {
    const buffer = await png()
    vi.mocked(net.fetch).mockResolvedValue(new Response(new Uint8Array(buffer), {
      headers: { 'content-type': 'application/octet-stream' }
    }))
    const result = await resolve('https://example.test/download')
    expect(result.mimeType).toBe('image/png')
    expect(Buffer.from(result.base64, 'base64')).toEqual(buffer)
  })

  it('rejects video disguised as a PNG data URL', async () => {
    await expect(resolve(`data:image/png;base64,${video.toString('base64')}`))
      .rejects.toThrow('requires a valid image')
  })

  it('detects the actual data URL image format and preserves bytes', async () => {
    const buffer = await png()
    const result = await resolve(`data:image/jpeg;base64,${buffer.toString('base64')}`)
    expect(result.mimeType).toBe('image/png')
    expect(Buffer.from(result.base64, 'base64')).toEqual(buffer)
  })

  it('rejects malformed, empty and oversized base64 data', async () => {
    await expect(resolve('data:image/png;base64,%%%')).rejects.toThrow('invalid base64')
    await expect(resolve('data:image/png;base64,')).rejects.toThrow('empty or too large')
    await expect(resolve(`data:image/png;base64,${'A'.repeat(28 * 1024 * 1024)}`))
      .rejects.toThrow('empty or too large')
  })

  it('rejects empty and damaged image bytes', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(new Uint8Array(0)))
    await expect(resolve('https://example.test/empty.png')).rejects.toThrow('requires a valid image')
    await expect(resolve(`data:image/png;base64,${Buffer.from('not an image').toString('base64')}`))
      .rejects.toThrow('requires a valid image')
  })
})

describe('buildPiBashTool', () => {
  function createTool(env: Record<string, string> = {}) {
    vi.stubEnv('SHELL', '/bin/bash')
    return buildPiBashTool({ agentCore, agentNode, cwd: process.cwd(), env })
  }

  it('keeps the project tool name and reuses the native schema and description', () => {
    const tool = createTool()
    const nativeTool = agentCore.createBashTool()
    expect(tool.name).toBe('Bash')
    expect(tool.label).toBe('Bash')
    expect(tool.parameters).toEqual(nativeTool.parameters)
    expect(tool.description).toBe(nativeTool.description)
  })

  it('executes in the workspace with runtime environment and forwards progress', async () => {
    const tool = createTool({ VECTCUT_BASH_TEST: 'runtime-value' })
    const onUpdate = vi.fn()
    const result = await tool.execute(
      'bash-1', { command: 'printf "%s\\n" "$PWD" "$VECTCUT_BASH_TEST"; printf "stderr\\n" >&2' },
      undefined, onUpdate, undefined
    )
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain(process.cwd())
    expect(text).toContain('runtime-value')
    expect(text).toContain('stderr')
    expect(onUpdate).toHaveBeenCalled()
  })

  it('preserves native nonzero-exit errors', async () => {
    await expect(createTool().execute(
      'bash-2', { command: 'printf "failed\\n" >&2; exit 7' }, undefined, undefined, undefined
    )).rejects.toThrow('Command exited with code 7')
  })

  it('uses native timeout handling', async () => {
    await expect(createTool().execute(
      'bash-3', { command: 'sleep 5', timeout: 0.05 }, undefined, undefined, undefined
    )).rejects.toThrow('Command timed out after 0.05 seconds')
  })

  it('defaults Bash execution to a three-minute timeout', async () => {
    vi.stubEnv('SHELL', '/bin/bash')
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], details: undefined }))
    const tool = buildPiBashTool({
      agentCore: { createBashTool: () => ({ ...agentCore.createBashTool(), execute }) } as any,
      agentNode,
      cwd: process.cwd(),
      env: {}
    })
    await tool.execute('bash-default-timeout', { command: 'pwd' }, undefined, undefined, undefined)
    expect(execute).toHaveBeenCalledWith(
      'bash-default-timeout', { command: 'pwd', timeout: 180 }, undefined, undefined, expect.any(Object)
    )
  })

  it('cancels a running command through the native tool', async () => {
    const controller = new AbortController()
    await expect(createTool().execute(
      'bash-4', { command: 'printf "ready\\n"; sleep 5' }, controller.signal,
      (update) => {
        if (update.content.some((part) => part.type === 'text' && part.text.includes('ready'))) {
          controller.abort()
        }
      }, undefined
    )).rejects.toThrow('Command aborted')
  })

  it('saves full oversized output using native truncation', async () => {
    const result = await createTool().execute(
      'bash-5', { command: 'for ((i=1; i<=2300; i++)); do printf "line-%s\\n" "$i"; done' },
      undefined, undefined, undefined
    )
    const details = result.details as { fullOutputPath: string; truncation: { truncated: boolean } }
    try {
      expect(details.truncation.truncated).toBe(true)
      expect(details.fullOutputPath).toBeTruthy()
      expect((result.content[0] as { text: string }).text).toContain('Full output:')
    } finally {
      if (details.fullOutputPath) await rm(details.fullOutputPath, { force: true })
    }
  })

  it('resolves bundled Git Bash only when executing on Windows', async () => {
    mockIsWin = true
    mockedValidateGitBashPath.mockReturnValue('C:\\PortableGit\\bin\\bash.exe')
    const execute = vi.fn(async (_id, _params, _signal, _onUpdate, context) => {
      expect(context.env.cwd).toBe(process.cwd())
      expect(context.env.shellPath).toBe('C:\\PortableGit\\bin\\bash.exe')
      expect(context.env.shellEnv.CLAUDE_CODE_GIT_BASH_PATH).toBe('C:\\PortableGit\\bin\\bash.exe')
      return { content: [{ type: 'text', text: 'ok' }], details: undefined }
    })
    const tool = buildPiBashTool({
      agentCore: { createBashTool: () => ({ ...agentCore.createBashTool(), execute }) } as any,
      agentNode,
      cwd: process.cwd(),
      env: { CLAUDE_CODE_GIT_BASH_PATH: 'C:\\PortableGit\\bin\\bash.exe' }
    })
    expect(mockedValidateGitBashPath).not.toHaveBeenCalled()
    await tool.execute('bash-win', { command: 'pwd' }, undefined, undefined, undefined)
    expect(execute).toHaveBeenCalledOnce()
  })
})

describe('buildLimitedPiToolPayload', () => {
  it('returns compact search candidates through the Codemode global', async () => {
    const schema = { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] }
    class Sandbox {
      constructor(private options: any) {}
      async execute() {
        const search = this.options.globals.find((tool: any) => tool.name === 'searchTools')
        const value = await search.execute(['search video', 5])
        return { ok: true, output: [], calls: [], value }
      }
      close = vi.fn()
    }
    const tool = buildCodemodeTool({
      packageBridge: {
        piAi: { Type: { Object: (value: unknown) => value, String: (value: unknown) => value } },
        piCodemode: { CodemodeSandbox: Sandbox }
      } as any,
      mcpTools: [
        { name: 'mcp__video__search', description: 'search video', parameters: schema },
        { name: 'mcp__audio__search', description: 'search audio', parameters: schema }
      ] as any,
      invokeContext: {
        runtime: { traceId: 'trace-1', workspacePath: '/tmp' }, projection: { topicId: 'topic-1' }
      } as any,
      pendingFileChanges: new Map()
    })
    const result = await tool.execute('search-1', { code: 'return await searchTools("search video")' })
    const results = JSON.parse((result.content[0] as any).text)
    expect(results[0]).not.toHaveProperty('inputSchema')
    expect(results[1]).not.toHaveProperty('inputSchema')
    expect(tool.description).toContain('without schemas')
  })

  it('forwards nested MCP progress without changing its final result', async () => {
    const events: unknown[] = []
    const signal = new AbortController().signal
    const close = vi.fn()
    const executeTool = vi.fn(async (_id, _args, receivedSignal, onUpdate) => {
      expect(receivedSignal).toBe(signal)
      onUpdate({ content: [{ type: 'text', text: 'processing' }], details: { progress: 50 } })
      return { content: [{ type: 'text', text: 'done' }], details: { draft_id: 'draft-1' } }
    })
    class Sandbox {
      constructor(private options: any) {}
      async execute(_code: string, context: any) {
        const value = await this.options.tools[0].execute({}, context)
        return { ok: true, output: [], calls: [], value }
      }
      close = close
    }
    const tool = buildCodemodeTool({
      packageBridge: {
        piAi: { Type: { Object: (value: unknown) => value, String: (value: unknown) => value } },
        piCodemode: { CodemodeSandbox: Sandbox }
      } as any,
      mcpTools: [{
        name: 'mcp__slow__tool', description: 'slow', parameters: {}, execute: executeTool
      }] as any,
      invokeContext: {
        runtime: { traceId: 'trace-1', workspacePath: '/tmp' }, projection: { topicId: 'topic-1' }
      } as any,
      pendingFileChanges: new Map(),
      emitNestedToolEvent: async event => { events.push(event) }
    })
    const result = await tool.execute('outer-1', { code: 'return await tools.slow({})' }, signal)
    expect(events.map((event: any) => event.type)).toEqual(['start', 'update', 'success'])
    expect((events[1] as any).toolCallId).toBe((events[0] as any).toolCallId)
    expect(result.content).toEqual([{
      type: 'text', text: JSON.stringify({ text: 'done', structuredContent: { draft_id: 'draft-1' } }, null, 2)
    }])
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps small MCP payloads structured for PI harness', () => {
    const payload = buildLimitedPiToolPayload(
      {
        content: [{ type: 'text', text: 'small result' }],
        structuredContent: { progress: 25, status: 'processing' }
      },
      'mcp__demo__tool 回包'
    )

    expect(payload).toEqual({
      content: [{ type: 'text', text: 'small result' }],
      details: { progress: 25, status: 'processing' }
    })
  })

  it('hard truncates oversized MCP payloads before they enter PI harness', () => {
    const payload = buildLimitedPiToolPayload(
      {
        content: [{ type: 'text', text: 'x'.repeat(80 * 1024) }],
        structuredContent: { preview: 'y'.repeat(16 * 1024) }
      },
      'mcp__demo__tool 回包'
    )

    expect(payload.details).toBeUndefined()
    expect(payload.content).toHaveLength(1)
    expect(payload.content[0]).toMatchObject({
      type: 'text'
    })

    const text = (payload.content[0] as { text?: string }).text || ''
    expect(text).toContain('已截断')
    expect(text).toContain('mcp__demo__tool 回包')
    expect(getUtf8ByteLength(text)).toBeLessThanOrEqual(MAX_INLINE_TOOL_PAYLOAD_BYTES)
  })
})

describe('resolveShellExecutable', () => {
  it('prefers configured Git Bash path on Windows', () => {
    mockIsWin = true
    mockedValidateGitBashPath.mockReturnValue('C:\\PortableGit\\bin\\bash.exe')
    mockedFindGitBash.mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    const result = resolveShellExecutable({
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\PortableGit\\bin\\bash.exe'
    })

    expect(result).toBe('C:\\PortableGit\\bin\\bash.exe')
  })

  it('falls back to discovered Git Bash on Windows', () => {
    mockIsWin = true
    mockedValidateGitBashPath.mockReturnValue(null)
    mockedFindGitBash.mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    const result = resolveShellExecutable({})

    expect(result).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
  })

  it('throws when Windows Git Bash is unavailable', () => {
    mockIsWin = true
    mockedValidateGitBashPath.mockReturnValue(null)
    mockedFindGitBash.mockReturnValue(null)

    expect(() => resolveShellExecutable({})).toThrow('Git Bash is required for shell execution on Windows')
  })
})


describe('MCP image inspection integration', () => {
  it('passes the three-minute timeout and preserves the generation result on inspection failure', async () => {
    const createServer = (name: string) => {
      const server = new McpServer({ name, version: '1' }, { capabilities: { tools: {} } })
      server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name, inputSchema: { type: 'object' as const } }]
      }))
      return server
    }
    const imageUrl = 'https://example.com/generated.png'
    const call = vi.spyOn(Client.prototype, 'callTool').mockImplementation(async (request) => {
      if (request.name === 'inspect_image') {
        throw Object.assign(new Error('Request timed out'), { code: -32001 })
      }
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', output: { image_url: imageUrl } }) }] }
    })
    let clients: Awaited<ReturnType<typeof buildMcpTools>>['clients'] = []
    try {
      const built = await buildMcpTools({
        packageBridge: {} as any,
        invokeContext: {
          runtime: { workspacePath: '/tmp/image-inspection-integration', traceId: 'trace-1' },
          projection: { topicId: 'topic-1', piSessionId: 'session-1' }
        } as any,
        options: { mcpServers: {
          image: { type: 'sdk', name: 'image', instance: createServer('generate_or_edit_image') },
          'image-understand': {
            type: 'sdk', name: 'image-understand', instance: createServer('inspect_image'), timeout: 180
          }
        } } as any
      })
      clients = built.clients
      const generate = built.tools.find(tool => tool.name === 'mcp__vectcut__image__generate_or_edit_image')!
      const inspect = built.tools.find(tool => tool.name === 'mcp__vectcut__image-understand__inspect_image')!
      await generate.execute('generation-1', { action: 'submit' })
      expect(call).toHaveBeenCalledWith(
        { name: 'generate_or_edit_image', arguments: { action: 'submit_and_wait' } },
        undefined, expect.any(Object)
      )
      await expect(inspect.execute('inspection-1', { image: imageUrl }))
        .rejects.toThrow('图片已生成，检查超时')
      expect(call).toHaveBeenLastCalledWith(
        { name: 'inspect_image', arguments: { image: imageUrl } },
        undefined, expect.objectContaining({ timeout: 180000 })
      )
      expect(call.mock.calls.filter(([request]) => request.name === 'generate_or_edit_image')).toHaveLength(1)
    } finally {
      await Promise.allSettled(clients.map(client => client.close()))
      call.mockRestore()
    }
  })
})
