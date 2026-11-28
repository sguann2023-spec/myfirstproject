import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { createServer } from 'node:http'
import path from 'node:path'
import sharp from 'sharp'
import { net } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

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

import { SqlitePiSessionStorage } from '../../../database/repositories/piSessionStorage'

import { findGitBash, validateGitBashPath } from '@main/utils/process'

import { buildPiRuntimeBridge, createClaudeCodeHarness, buildBuiltinTools, resolvePiRuntimeApiKey, normalizeOpenAiMessages, wrapPiApiModuleWithPayloadNormalization, buildMcpTools, buildCodemodeTool, buildLimitedPiToolPayload, buildPiBashTool, resolveShellExecutable, resolveReadImageAsContentInput } from '../harness/create-harness'

import { estimateContextText } from '../harness/context-compaction'
import { resolveCustomReasoningMap, resolveModelConfig } from '../../../../../../components/ModelSettings/modelCatalog.js'
import { compileCustomReasoningMap } from '../reasoning-map'
import { createTokenTelemetryCollector } from '../harness/token-telemetry'
import { createRuntimeTelemetryObserver } from '../harness/create-harness'
import { mergeTokenTelemetry, isTokenTelemetry, type TokenTelemetry } from '@shared/tokenTelemetry'

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

describe('runtime telemetry background projection queue', () => {
  it.each(['buildContext', 'projector'] as const)('does not make harness events await a blocked %s and flushes serially', async blocked => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const order: string[] = []
    const collector = createTokenTelemetryCollector({ runtimeSessionId: 'real-session', invocationId: 'i', modelId: 'm', providerId: 'p' })
    let telemetry: TokenTelemetry | undefined
    collector.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
    let builds = 0
    const observer = createRuntimeTelemetryObserver({
      harness: { getModel: () => ({ id: 'm' }) },
      session: { buildContext: async () => { builds++; order.push('build'); if (blocked === 'buildContext') await gate; return { messages: [] } } },
      projectReadImageContext: async messages => { order.push('project'); if (blocked === 'projector') await gate; return messages },
      contextPayload: messages => ({ messages }), tokenTelemetry: collector, modelId: 'm', providerId: 'p'
    })
    // Mimic Pi emitAny's sequential await of each subscription return value.
    const dispatch = async () => { await observer.listener({ type: 'message_end' }); order.push('next-listener') }
    await dispatch()
    expect(order).toContain('next-listener')
    expect(telemetry).toBeUndefined()
    expect(observer.listener({ type: 'turn_end' })).toBeUndefined()
    let flushed = false
    const flush = observer.flush().then(() => { flushed = true })
    await Promise.resolve()
    expect(flushed).toBe(false)
    expect(builds).toBe(1)
    release(); await flush
    expect(builds).toBe(2)
    expect(telemetry!.context).toMatchObject({ runtimeSessionId: 'real-session', basis: 'post-response' })
  })
  it('contains failed projection to telemetry invalidation and keeps the queue usable', async () => {
    const collector = createTokenTelemetryCollector({ runtimeSessionId: 'session', invocationId: 'i', modelId: 'm', providerId: 'p' })
    let telemetry: TokenTelemetry | undefined
    collector.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
    const project = vi.fn().mockRejectedValueOnce(new Error('disk projection failed')).mockResolvedValue([])
    const observer = createRuntimeTelemetryObserver({ harness: { getModel: () => ({ id: 'm' }) }, session: { buildContext: async () => ({ messages: [] }) }, projectReadImageContext: project, contextPayload: messages => ({ messages }), tokenTelemetry: collector, modelId: 'm', providerId: 'p' })
    expect(observer.listener({ type: 'message_end' })).toBeUndefined()
    await expect(observer.flush()).resolves.toBeUndefined()
    expect(telemetry!.context).toMatchObject({ basis: 'invalidated', reason: 'runtime-context-rebuild-unavailable' })
    observer.listener({ type: 'turn_end' }); await observer.flush()
    expect(telemetry!.context!.basis).toBe('post-response')
  })
})

describe('real Pi adapters against loopback HTTP (no paid services)', () => {
  it.each([
    ['openai-completions', undefined], ['anthropic-messages', undefined],
    ['openai-completions', 'off'], ['anthropic-messages', 'off'],
    ['openai-completions', 'on'], ['anthropic-messages', 'on']
  ] as const)('sends and parses %s (%s) through production provider/auth/adapter chain', async (api, thinkingLevel) => {
    const requests: Array<{ url: string; headers: any; body: any }> = []
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      requests.push({ url: req.url!, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (api === 'openai-completions') {
        res.end(`data: ${JSON.stringify({ id: 'local', object: 'chat.completion.chunk', created: 1, model: 'local-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'local-ok' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'local', object: 'chat.completion.chunk', created: 1, model: 'local-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      } else {
        const events = [
          { type: 'message_start', message: { id: 'local', type: 'message', role: 'assistant', content: [], model: 'local-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'local-ok' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
          { type: 'message_stop' }
        ]
        res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as import('node:net').AddressInfo).port
      // OpenAI expects the configured /v1; Anthropic SDK appends /v1/messages itself.
      const baseUrl = `http://127.0.0.1:${port}/explicit${api === 'openai-completions' ? '/v1' : ''}`
      const pi = await import('@earendil-works/pi-ai')
      const realAdapter = api === 'openai-completions'
        ? await import('@earendil-works/pi-ai/api/openai-completions')
        : await import('@earendil-works/pi-ai/api/anthropic-messages')
      const environment = { env: { ANTHROPIC_API_KEY: 'must-not-use-login-token' }, modelInfo: { provider: { id: 'custom-local', type: api === 'openai-completions' ? 'openai' : 'anthropic', apiHost: baseUrl, apiKey: 'local-only-key' } } } as any
      const key = resolvePiRuntimeApiKey(environment, baseUrl)
      const models = pi.createModels()
      const tokenTelemetry = createTokenTelemetryCollector({ runtimeSessionId: 'local-runtime', invocationId: 'local-invocation', modelId: 'local-model', providerId: 'custom-local', provenance: [{ text: 'hello-local', category: 'user', role: 'user' }] })
      let telemetry: TokenTelemetry | undefined
      tokenTelemetry.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
      const model = { id: 'local-model', name: 'Local', api, provider: 'local-test', baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 64 } as any
      models.setProvider(pi.createProvider({
        id: 'local-test', baseUrl,
        auth: { apiKey: { name: 'local', async resolve() { return { auth: { headers: { Authorization: `Bearer ${key}` } } } } } },
        models: [model],
        api: wrapPiApiModuleWithPayloadNormalization({
          apiModule: realAdapter as any,
          invokeContext: { thinkingLevel, runtime: { provider: { id: 'bailian' }, model: { id: 'qwen3.8-flash' } } } as any,
          providerApiType: api,
          tokenTelemetry,
          // Only the adapter's transport is redirected to loopback. Exercise the
          // real gateway eligibility guard without sending credentials off-host.
          baseUrl: 'https://open.vectcut.com/v1'
        })
      }))
      const result = await models.completeSimple(model, { messages: [{ role: 'user', content: 'hello-local', timestamp: 1 }], tools: [{ name: 'local_tool', description: 'Local test tool', parameters: { type: 'object', properties: {} } }] }, { maxTokens: 32 })
      expect(result.stopReason).toBe('stop')
      expect(result.content).toContainEqual({ type: 'text', text: 'local-ok' })
      expect(isTokenTelemetry(telemetry)).toBe(true)
      expect(telemetry!.requests).toHaveLength(1)
      expect(telemetry!.requests[0]).toMatchObject({ status: 'completed', attempts: 1, providerId: 'custom-local' })
      expect(telemetry!.requests[0].input.categories.user).toBeGreaterThan(0)
      expect(telemetry!.requests[0].input.categories.toolDefinitions).toBeGreaterThan(0)
      expect(telemetry!.requests[0].output?.categories.reply).toBeGreaterThan(0)
      expect(telemetry!.context?.contextWindowTokens).toBeNull()
      expect(JSON.stringify(telemetry)).not.toContain('local-only-key')
      expect(JSON.stringify(telemetry)).not.toContain('hello-local')
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(api === 'openai-completions' ? '/explicit/v1/chat/completions' : '/explicit/v1/messages')
      expect(requests[0].headers.authorization).toBe('Bearer local-only-key')
      expect(requests[0].body.model).toBe('local-model')
      expect(requests[0].body.stream).toBe(true)
      expect(requests[0].body.tool_choice).toEqual(api === 'anthropic-messages' ? { type: 'auto' } : 'auto')
      expect(JSON.stringify(requests[0].body.messages)).toContain('hello-local')
      if (api === 'anthropic-messages') expect(requests[0].headers['anthropic-version']).toBe('2023-06-01')
      const body = requests[0].body
      const diagnostic = logMocks.info.mock.calls.find(([event]) => event === '[AgentCore] thinking payload')?.[1]
      expect(diagnostic).toMatchObject({ model: 'qwen3.8-flash', protocol: api, selectedLevel: thinkingLevel ?? null, gatewayEligible: true })
      expect(Object.keys(diagnostic).sort()).toEqual(['traceId', 'model', 'protocol', 'selectedLevel', 'gatewayEligible', 'enableThinking', 'thinkingType', 'effort'].sort())
      const serializedDiagnostic = JSON.stringify(diagnostic)
      expect(serializedDiagnostic).not.toContain('local-only-key')
      expect(serializedDiagnostic).not.toContain('hello-local')
      expect(JSON.parse(serializedDiagnostic)).toMatchObject({
        selectedLevel: thinkingLevel ?? null,
        enableThinking: thinkingLevel && api === 'openai-completions' ? thinkingLevel === 'on' : null,
        thinkingType: thinkingLevel && api === 'anthropic-messages' ? thinkingLevel === 'on' ? 'enabled' : 'disabled' : null,
        effort: null
      })
      if (thinkingLevel) {
        if (api === 'openai-completions') {
          expect(body.enable_thinking).toBe(thinkingLevel === 'on')
          expect(body.thinking).toBeUndefined()
        } else {
          expect(body.thinking).toEqual({ type: thinkingLevel === 'on' ? 'enabled' : 'disabled' })
          expect(body.enable_thinking).toBeUndefined()
        }
      } else {
        expect(body.enable_thinking).toBeUndefined()
        expect(body.thinking).toBeUndefined()
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})

describe('production Pi bridge pre-request context compaction', () => {
  const contextWindowTokens = 30000
  const maxOutputTokens = 1000
  const checkpointText = 'LOCAL_CHECKPOINT: preserve the goal, completed work and next action.'
  const currentRequest = 'RECENT_USER: finish the small current task.'
  const oldUserText = `OLD_USER_TRANSCRIPT ${'historical-user '.repeat(4000)}`
  const oldAssistantText = `OLD_ASSISTANT_TRANSCRIPT ${'historical-assistant '.repeat(2000)}`

  afterEach(() => vi.restoreAllMocks())

  async function fixture(input: {
    mode?: 'history' | 'tool-round'
    gateway?: boolean
    api?: 'openai-completions' | 'anthropic-messages'
    maxOutputTokens?: number
    maxInputTokens?: number
    summaryText?: string
    summaryUsage?: { input: number; output: number }
    summaryDrops?: number
  } = {}) {
    const api = input.api ?? 'openai-completions'
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-bridge-compaction-'))
    const storage = new agentCore.InMemorySessionStorage()
    const seed = new agentCore.Session(storage)
    if (input.mode !== 'tool-round') {
      await seed.appendMessage({ role: 'user', content: oldUserText, timestamp: 1 })
      await seed.appendMessage({
        ...((await import('@earendil-works/pi-ai')).fauxAssistantMessage(oldAssistantText)),
        api: 'openai-completions', provider: 'old-provider', model: 'old-model', timestamp: 2
      })
    }
    await writeFile(path.join(directory, 'local-result.txt'), 'LOCAL_TOOL_RESULT: the local file was read successfully.')
    const requests: Array<{ kind: 'summary' | 'task'; body: any; checkpoints: number; metadata: any; options: any }> = []
    const adapterOptions: any[] = []
    const progress: any[] = []
    const order: string[] = []
    let taskCalls = 0
    let summaryCalls = 0
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const options = adapterOptions[requests.length]
      const metadata = options?.metadata
      const kind = metadata?.context_compaction === 'true' ? 'summary' : 'task'
      requests.push({ kind, body, metadata, options, checkpoints: (await storage.findEntries('compaction')).length })
      order.push(`request:${kind}`)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const summaryText = input.summaryText ?? checkpointText
      const usage = kind === 'summary' ? input.summaryUsage : undefined
      if (api === 'anthropic-messages') {
        const events = [
          { type: 'message_start', message: { id: 'local-compaction', type: 'message', role: 'assistant', content: [], model: 'deepseek-local', stop_reason: null, stop_sequence: null, usage: { input_tokens: usage?.input ?? 1, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: kind === 'summary' ? summaryText : 'local-task-complete' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage?.output ?? 1 } },
          { type: 'message_stop' }
        ]
        res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
        return
      }
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        `data: ${JSON.stringify({ id: 'local-compaction', object: 'chat.completion.chunk', created: 1, model: 'deepseek-local', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      if (kind === 'summary') {
        summaryCalls += 1
        if (summaryCalls <= (input.summaryDrops ?? 0)) {
          res.write(chunk({ role: 'assistant', content: 'REJECTED_PARTIAL_CHECKPOINT' }))
          setTimeout(() => res.destroy(), 10)
          return
        }
        // Keep usage absent by default: existing OpenAI fixtures must remain valid.
        const usageChunk = usage ? `data: ${JSON.stringify({ id: 'local-compaction', object: 'chat.completion.chunk', created: 1, model: 'deepseek-local', choices: [], usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } })}\n\n` : ''
        res.end(chunk({ role: 'assistant', content: summaryText }) + chunk({}, 'stop') + usageChunk + 'data: [DONE]\n\n')
      } else {
        taskCalls += 1
        if (input.mode === 'tool-round' && taskCalls === 1) {
          // The large assistant response crosses 70% only after the first tool
          // round. No second prompt or idle-only harness.compact() can mask it.
          res.end(chunk({ role: 'assistant', content: `ROUND_ONE_TRANSCRIPT ${'round-one-history '.repeat(5200)}`, tool_calls: [{
            index: 0, id: 'local-read-call', type: 'function',
            function: { name: 'Read', arguments: JSON.stringify({ path: 'local-result.txt' }) }
          }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n')
        } else {
          res.end(chunk({ role: 'assistant', content: 'local-task-complete' }) + chunk({}, 'stop') + 'data: [DONE]\n\n')
        }
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as import('node:net').AddressInfo).port
    const localBaseUrl = `http://127.0.0.1:${port}${api === 'openai-completions' ? '/v1' : ''}`
    const piAi = await import('@earendil-works/pi-ai')
    const realAdapter = api === 'openai-completions'
      ? await import('@earendil-works/pi-ai/api/openai-completions')
      : await import('@earendil-works/pi-ai/api/anthropic-messages')
    // Only redirect the physical transport for the gateway case; the production
    // wrapper still receives the trusted gateway URL and real auth/provider.
    const localAdapter = Object.fromEntries((['stream', 'streamSimple'] as const).map(method => [method,
      (model: any, context: any, options: any) => {
        adapterOptions.push(options)
        return (realAdapter[method] as any)({ ...model, baseUrl: localBaseUrl }, context, options)
      }
    ]))
    const provider = { id: input.gateway ? 'builtin' : 'custom-local', type: api === 'openai-completions' ? 'openai' : 'anthropic', apiHost: input.gateway ? 'https://open.vectcut.com/v1' : localBaseUrl, apiKey: 'local-only-key' }
    const open = vi.spyOn(SqlitePiSessionStorage, 'openOrCreate').mockResolvedValueOnce(storage as any)
    let bridge: Awaited<ReturnType<typeof buildPiRuntimeBridge>> | undefined
    let unsubscribe = () => {}
    const cleanup = async () => {
      unsubscribe()
      if (bridge) {
        await bridge.harness.abort()
        await Promise.allSettled(bridge.mcpClients.map(client => client.close()))
      }
      open.mockRestore()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await rm(directory, { recursive: true, force: true })
    }
    try {
      bridge = await buildPiRuntimeBridge({
        packageBridge: { agentCore, agentNode, piAi, openAiCompletionsApi: localAdapter, anthropicMessagesApi: localAdapter } as any,
        invokeContext: {
          runtime: { workspacePath: directory, traceId: 'compaction-trace', sessionId: 'compaction-session', model: { id: 'deepseek-local', supportsImageInput: false }, provider },
          projection: { topicId: 'compaction-topic', userMessageId: 'compaction-user', piSessionId: 'old-segment-sdk-id' },
          tools: { activeToolNames: input.mode === 'tool-round' ? ['Read'] : [] },
          thinkingLevel: 'max', skills: {},
          prompt: { systemPrompt: 'Follow the current user request.', resources: {
            skills: [{ name: 'local-skill', description: 'A local test skill', content: 'LOCAL_SKILL_BODY: preserve this skill instruction.', filePath: path.join(directory, 'SKILL.md') }],
            promptTemplates: []
          } }
        } as any,
        runtimeEnvironment: {
          env: { ANTHROPIC_API_KEY: 'local-only-key' }, modelInfo: { valid: true, modelId: 'deepseek-local', provider },
          modelTokenLimits: { contextWindowTokens, maxOutputTokens: input.maxOutputTokens ?? maxOutputTokens, maxInputTokens: input.maxInputTokens },
          customReasoning: input.gateway ? undefined : { level: 'max', patch: {
            enable_thinking: true, reasoning_effort: 'max', thinking: { type: 'enabled', budget_tokens: 8192 },
            chat_template_kwargs: { enable_thinking: true }
          } }
        } as any,
        options: {}, pendingFileChanges: new Map()
      })
      expect(bridge.contextCompaction).toBeDefined()
      unsubscribe = bridge.contextCompaction!.subscribe(event => { progress.push(event); order.push(`progress:${event.phase}`) })
      return { bridge, storage, requests, progress, order, cleanup }
    } catch (error) {
      await cleanup()
      throw error
    }
  }

  it.each(['prompt', 'skill'] as const)('compacts persisted history before the first %s task request through the real Pi adapter', async method => {
    const local = await fixture()
    try {
      let telemetry: TokenTelemetry | undefined
      const unsubscribeTelemetry = local.bridge.tokenTelemetry!.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
      expect(local.requests).toEqual([])
      expect(await local.storage.findEntries('compaction')).toEqual([])
      const result = method === 'skill'
        ? await local.bridge.harness.skill('local-skill', currentRequest)
        : await local.bridge.harness.prompt(currentRequest)
      expect(result.stopReason).toBe('stop')
      expect(result.content).toContainEqual({ type: 'text', text: 'local-task-complete' })
      const summaries = local.requests.filter(request => request.kind === 'summary')
      const tasks = local.requests.filter(request => request.kind === 'task')
      expect(summaries.length).toBeGreaterThan(0)
      expect(tasks).toHaveLength(1)
      expect(local.requests.at(-1)).toBe(tasks[0])
      expect(tasks[0].checkpoints).toBe(1)
      const summaryBodies = JSON.stringify(summaries.map(request => request.body.messages))
      expect(summaryBodies).toContain('OLD_USER_TRANSCRIPT')
      expect(summaryBodies).toContain('OLD_ASSISTANT_TRANSCRIPT')
      const taskBody = JSON.stringify(tasks[0].body.messages)
      expect(taskBody).toContain(checkpointText)
      expect(taskBody).toContain(currentRequest)
      expect(taskBody).not.toContain('OLD_USER_TRANSCRIPT')
      expect(taskBody).not.toContain('OLD_ASSISTANT_TRANSCRIPT')
      if (method === 'skill') expect(taskBody).toContain('LOCAL_SKILL_BODY')
      expect(local.progress[0]).toMatchObject({ phase: 'start' })
      expect(local.progress[0].tokensBefore).toBeGreaterThanOrEqual(contextWindowTokens * 0.7)
      expect(local.progress.at(-1)).toMatchObject({ phase: 'complete' })
      expect(local.progress.at(-1).tokensAfter).toBeLessThan(contextWindowTokens * 0.7)
      expect(local.order.indexOf('progress:complete')).toBeLessThan(local.order.indexOf('request:task'))
      expect(local.bridge.contextCompaction!.getFailure()).toBeUndefined()
      expect(await local.storage.findEntries('compaction')).toMatchObject([{ fromHook: true, details: { policy: 'pre-request-70-percent' } }])
      await local.bridge.flushTokenTelemetryQueue!()
      expect(telemetry!.requests.length).toBeGreaterThan(0)
      expect(telemetry!.requests.every(request => request.runtimeSessionId === 'compaction-session')).toBe(true)
      expect(telemetry!.context!.runtimeSessionId).toBe('compaction-session')
      expect(JSON.stringify(telemetry)).not.toContain('old-segment-sdk-id')
      unsubscribeTelemetry()
    } finally { await local.cleanup() }
  })

  it('recovers two partial summary stream disconnects through the real Pi adapter before continuing the task', async () => {
    const local = await fixture({ summaryDrops: 2 })
    try {
      const result = await local.bridge.harness.prompt(currentRequest)
      expect(result.stopReason).toBe('stop')
      const summaries = local.requests.filter(request => request.kind === 'summary')
      expect(summaries.length).toBeGreaterThanOrEqual(3)
      expect(summaries[1].body).toEqual(summaries[0].body)
      expect(summaries[2].body).toEqual(summaries[0].body)
      expect(summaries.every(request => request.checkpoints === 0 && request.options.maxRetries === 0)).toBe(true)
      expect(JSON.stringify(summaries.map(request => request.body.messages))).not.toContain('REJECTED_PARTIAL_CHECKPOINT')
      const tasks = local.requests.filter(request => request.kind === 'task')
      expect(tasks).toHaveLength(1)
      expect(tasks[0].checkpoints).toBe(1)
      expect(JSON.stringify(tasks[0].body.messages)).toContain(checkpointText)
      expect(JSON.stringify(tasks[0].body.messages)).not.toContain('REJECTED_PARTIAL_CHECKPOINT')
      expect(await local.storage.findEntries('compaction')).toHaveLength(1)
      expect(local.progress.at(-1)).toMatchObject({ phase: 'complete', summary: checkpointText })
      expect(local.bridge.contextCompaction!.getFailure()).toBeUndefined()
    } finally { await local.cleanup() }
  })

  it('compacts between tool rounds within one running prompt, not only while idle', async () => {
    const local = await fixture({ mode: 'tool-round' })
    const compact = vi.spyOn(local.bridge.harness, 'compact')
    try {
      const result = await local.bridge.harness.prompt(currentRequest)
      expect(result.stopReason).toBe('stop')
      const tasks = local.requests.filter(request => request.kind === 'task')
      expect(tasks).toHaveLength(2)
      expect(tasks[0].checkpoints).toBe(0)
      expect(tasks[1].checkpoints).toBe(1)
      const kinds = local.requests.map(request => request.kind)
      expect(kinds[0]).toBe('task')
      expect(kinds.slice(1, -1).length).toBeGreaterThan(0)
      expect(kinds.slice(1, -1).every(kind => kind === 'summary')).toBe(true)
      expect(kinds.at(-1)).toBe('task')
      const summaries = JSON.stringify(local.requests.filter(request => request.kind === 'summary').map(request => request.body.messages))
      expect(summaries).toContain('ROUND_ONE_TRANSCRIPT')
      expect(summaries).toContain('LOCAL_TOOL_RESULT')
      const nextTask = JSON.stringify(tasks[1].body.messages)
      expect(nextTask).toContain(checkpointText)
      expect(nextTask).toContain(currentRequest)
      expect(nextTask).not.toContain('ROUND_ONE_TRANSCRIPT')
      expect(local.progress[0].tokensBefore).toBeGreaterThanOrEqual(contextWindowTokens * 0.7)
      expect(local.progress.at(-1).tokensAfter).toBeLessThan(contextWindowTokens * 0.7)
      expect(compact).not.toHaveBeenCalled()
      expect(local.bridge.contextCompaction!.getFailure()).toBeUndefined()
    } finally { await local.cleanup() }
  })

  for (const api of ['openai-completions', 'anthropic-messages'] as const) {
    it.each([
      { gateway: false, maxOutputTokens: 8192, expectedCap: 2048 },
      { gateway: true, maxOutputTokens: 8192, expectedCap: 2048 },
      { gateway: false, maxOutputTokens, expectedCap: maxOutputTokens },
      { gateway: true, maxOutputTokens, expectedCap: maxOutputTokens },
      { gateway: false, maxOutputTokens: 8192, maxInputTokens: 12000, expectedCap: 1200 }
    ])(`${api} preserves the bounded summary output without a thinking allowance: %j`, async limits => {
      const local = await fixture({ api, ...limits })
      try {
        expect((await local.bridge.harness.prompt(currentRequest)).stopReason).toBe('stop')
        const summaries = local.requests.filter(request => request.kind === 'summary')
        expect(summaries.length).toBeGreaterThan(0)
        for (const { body, metadata, options } of summaries) {
          // Check before streamSimple can add a thinking budget, and again on wire.
          expect(metadata).toMatchObject({ context_compaction: 'true' })
          expect(options.reasoning).toBeUndefined()
          expect(options.thinkingBudgets).toBeUndefined()
          expect(options.maxTokens).toBe(limits.expectedCap)
          expect(JSON.stringify(body.messages)).toContain('<transcript>')
          expect(body.max_tokens ?? body.max_completion_tokens).toBe(limits.expectedCap)
          expect(body.reasoning_effort).toBeUndefined()
          expect(body.reasoning).toBeUndefined()
          expect(body.output_config?.effort).toBeUndefined()
          expect(body.chat_template_kwargs).toBeUndefined()
          expect(body.thinking).toEqual(limits.gateway && api === 'anthropic-messages' ? { type: 'disabled' } : undefined)
          expect(body.enable_thinking).toBe(limits.gateway && api === 'openai-completions' ? false : undefined)
        }
        const task = local.requests.find(request => request.kind === 'task')!.body
        if (!limits.gateway) {
          expect(task).toMatchObject({ reasoning_effort: 'max', enable_thinking: true, thinking: { type: 'enabled', budget_tokens: 8192 } })
        } else if (api === 'openai-completions') {
          expect(task).toMatchObject({ reasoning_effort: 'max', enable_thinking: true })
        } else {
          expect(task).toMatchObject({ thinking: { type: 'enabled' }, output_config: { effort: 'max' } })
        }
        expect(local.progress.at(-1)).toMatchObject({ phase: 'complete' })
        expect(local.bridge.contextCompaction!.getFailure()).toBeUndefined()
      } finally { await local.cleanup() }
    })

    it(`${api} accepts a stopped CJK summary with valid usage below the cap even when the local estimate exceeds it`, async () => {
      const summaryText = '保留目标与约束，记录已完成工作、文件路径以及下一步。'.repeat(50)
      const summaryUsage = { input: 6000, output: 800 }
      expect(estimateContextText(summaryText)).toBeGreaterThan(maxOutputTokens)
      expect(summaryUsage.output).toBeLessThan(maxOutputTokens)
      const local = await fixture({ api, summaryText, summaryUsage })
      let telemetry: TokenTelemetry | undefined
      const unsubscribe = local.bridge.tokenTelemetry!.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
      try {
        const result = await local.bridge.harness.prompt(currentRequest)
        expect(result.stopReason).toBe('stop')
        expect(result.content).toContainEqual({ type: 'text', text: 'local-task-complete' })
        const summaries = local.requests.filter(request => request.kind === 'summary')
        expect(summaries.length).toBeGreaterThan(0)
        expect(summaries.every(({ body }) => (body.max_tokens ?? body.max_completion_tokens) === maxOutputTokens)).toBe(true)
        const tasks = local.requests.filter(request => request.kind === 'task')
        expect(tasks).toHaveLength(1)
        expect(tasks[0].checkpoints).toBe(1)
        expect(JSON.stringify(tasks[0].body.messages)).toContain(summaryText)
        expect(JSON.stringify(tasks[0].body.messages)).toContain(currentRequest)
        expect(JSON.stringify(tasks[0].body.messages)).not.toContain('OLD_USER_TRANSCRIPT')
        expect(await local.storage.findEntries('compaction')).toHaveLength(1)
        expect(local.progress.at(-1)).toMatchObject({ phase: 'complete', summary: summaryText })
        expect(local.progress.some(event => event.phase === 'failed')).toBe(false)
        expect(local.bridge.contextCompaction!.getFailure()).toBeUndefined()
        await local.bridge.flushTokenTelemetryQueue!()
        const reportedSummaries = telemetry!.requests.filter(request => request.operation === 'compaction')
        expect(reportedSummaries).toHaveLength(summaries.length)
        for (const request of reportedSummaries) {
          expect(request).toMatchObject({ status: 'completed', attempts: 1, reported: { inputTokens: summaryUsage.input, outputTokens: summaryUsage.output } })
        }
      } finally { unsubscribe(); await local.cleanup() }
    })
  }
})

describe('gateway thinking selection', () => {
  async function payloadFor(level: unknown, protocol: 'anthropic-messages' | 'openai-completions', model = 'deepseek-v4', providerId = 'builtin', baseUrl = 'https://open.vectcut.com/v1', method = 'stream') {
    const underlying = vi.fn((_model, _context, options) => options)
    const wrapper = wrapPiApiModuleWithPayloadNormalization({
      apiModule: { stream: underlying, streamSimple: underlying } as any,
      invokeContext: { thinkingLevel: level, runtime: { provider: { id: providerId }, model: { id: model } } } as any,
      providerApiType: protocol, baseUrl
    })
    const payload: any = { enable_thinking: true, thinking: {}, reasoning: {}, reasoning_effort: 'stale', chat_template_kwargs: {}, output_config: { effort: 'stale', format: 'json' } }
    const options = (wrapper as any)[method]({}, {}, { onPayload: () => payload })
    await options.onPayload({}, {})
    return payload
  }

  for (const protocol of ['anthropic-messages', 'openai-completions'] as const) {
    it.each(['off', 'on', 'low', 'medium', 'high', 'xhigh', 'max', 'none'])(`${protocol} maps %s to backend fields`, async level => {
      const payload = await payloadFor(level, protocol)
      const enabled = level !== 'off' && level !== 'none'
      if (protocol === 'openai-completions') {
        expect(payload.enable_thinking).toBe(level === 'none' ? undefined : enabled)
        expect(payload.reasoning_effort).toBe(['off', 'on'].includes(level) ? undefined : level)
        expect(payload.thinking).toBeUndefined()
        expect(payload.output_config).toEqual({ format: 'json' })
      } else {
        expect(payload.thinking).toEqual(level === 'none' ? undefined : { type: enabled ? 'enabled' : 'disabled' })
        expect(payload.output_config).toEqual(['off', 'on'].includes(level) ? { format: 'json' } : { format: 'json', effort: level })
        expect(payload.enable_thinking).toBeUndefined()
        expect(payload.reasoning_effort).toBeUndefined()
      }
      expect(payload.reasoning).toBeUndefined()
      expect(payload.chat_template_kwargs).toBeUndefined()
    })

    it('cleans invalid, absent, custom and foreign destination selections', async () => {
      for (const [level, provider, url] of [
        [undefined, 'builtin', 'https://open.vectcut.com/v1'],
        ['invalid', 'builtin', 'https://open.vectcut.com/v1'],
        ['high', 'custom-123', 'https://open.vectcut.com/v1'],
        ['high', 'builtin', 'https://foreign.example/v1'],
        ['high', 'builtin', 'https://open.vectcut.com.evil.example/v1']
      ]) {
        const payload = await payloadFor(level, protocol, 'deepseek-v4', provider, url, 'streamSimple')
        expect(payload.output_config).toEqual({ format: 'json' })
        for (const key of ['thinking', 'enable_thinking', 'reasoning_effort']) expect(payload[key]).toBeUndefined()
      }
    })

    it('does not force thinking for non-DeepSeek effort selections', async () => {
      const payload = await payloadFor('high', protocol, 'gpt-5', undefined, undefined, 'streamSimple')
      expect(payload.enable_thinking).toBeUndefined()
      expect(payload.thinking).toBeUndefined()
      expect(protocol === 'anthropic-messages' ? payload.output_config.effort : payload.reasoning_effort).toBe('high')
    })
  }
})

describe('custom reasoning snapshot payload integration', () => {
  it.each(['stream', 'streamSimple'] as const)('%s suppresses original custom/gateway max thinking only for context compaction', async method => {
    for (const providerApiType of ['openai-completions', 'anthropic-messages'] as const) {
      for (const custom of [false, true]) {
        const underlying = vi.fn((_model, _context, options) => options)
        const patch = { enable_thinking: true, thinking: { type: 'enabled', budget_tokens: 8192 }, reasoning_effort: 'max', output_config: { effort: 'max' }, chat_template_kwargs: { enable_thinking: true } }
        const wrapper = wrapPiApiModuleWithPayloadNormalization({
          apiModule: { stream: underlying, streamSimple: underlying } as any,
          invokeContext: { thinkingLevel: 'max', runtime: { provider: { id: custom ? 'custom-exact' : 'builtin' }, model: { id: 'deepseek-local' } } } as any,
          providerApiType, baseUrl: 'https://open.vectcut.com/v1',
          customReasoning: custom ? { level: 'max', patch } : undefined
        })
        const payload = () => ({ ...structuredClone(patch), reasoning: { effort: 'max' }, output_config: { effort: 'max', format: 'json' }, messages: [{ role: 'user', content: 'local transcript' }] })
        const summary: any = payload()
        // Also exercise a replacement payload returned by the existing callback.
        const summaryOptions = (wrapper[method] as any)({}, {}, {
          metadata: { context_compaction: 'true' }, onPayload: () => summary
        })
        expect(await summaryOptions.onPayload({}, {})).toBe(summary)
        expect(summaryOptions.metadata).toEqual({ context_compaction: 'true' })
        expect(summary.reasoning_effort).toBeUndefined()
        expect(summary.reasoning).toBeUndefined()
        expect(summary.chat_template_kwargs).toBeUndefined()
        expect(summary.output_config).toEqual({ format: 'json' })
        expect(summary.enable_thinking).toBe(!custom && providerApiType === 'openai-completions' ? false : undefined)
        expect(summary.thinking).toEqual(!custom && providerApiType === 'anthropic-messages' ? { type: 'disabled' } : undefined)
        const task: any = payload()
        await (wrapper[method] as any)({}, {}, {}).onPayload(task, {})
        if (custom) expect(task).toMatchObject(patch)
        else if (providerApiType === 'openai-completions') expect(task).toMatchObject({ enable_thinking: true, reasoning_effort: 'max' })
        else expect(task).toMatchObject({ thinking: { type: 'enabled' }, output_config: { effort: 'max', format: 'json' } })
        expect(patch.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 })
      }
    }
  })

  it.each(['stream', 'streamSimple'] as const)('%s applies independent custom snapshots after cleanup for both protocols', async method => {
    for (const providerApiType of ['openai-completions', 'anthropic-messages'] as const) {
      const underlying = vi.fn((_model, _context, options) => options)
      const create = (patch: Record<string, unknown>, providerId = 'custom-exact') => wrapPiApiModuleWithPayloadNormalization({
        apiModule: { stream: underlying, streamSimple: underlying } as any,
        invokeContext: { thinkingLevel: 'HIGH', runtime: { provider: { id: providerId }, model: { id: 'same-model' } } } as any,
        providerApiType, baseUrl: 'https://open.vectcut.com/v1', customReasoning: { level: 'HIGH', patch }
      })
      const firstPatch = { enable_thinking: false, thinking: { type: 'enabled', budget_tokens: 2048 }, output_config: { effort: 'HIGH' }, chat_template_kwargs: { enable_thinking: true } }
      const first = (create(firstPatch) as any)[method]({}, {}, {})
      const second = (create({ reasoning_effort: 'Low' }) as any)[method]({}, {}, {})
      const payload = () => ({ enable_thinking: true, thinking: { type: 'stale' }, reasoning: {}, reasoning_effort: 'stale', chat_template_kwargs: { stale: true }, output_config: { effort: 'stale', format: 'json' }, tools: [{ name: 'test' }] })
      const a: any = payload(); const b: any = payload()
      await Promise.all([first.onPayload(a, {}), second.onPayload(b, {})])
      expect(a).toMatchObject({ ...firstPatch, output_config: { effort: 'HIGH', format: 'json' }, tool_choice: providerApiType === 'anthropic-messages' ? { type: 'auto' } : 'auto' })
      expect(a.reasoning_effort).toBeUndefined()
      expect(a.reasoning).toBeUndefined()
      expect(b.reasoning_effort).toBe('Low')
      expect(b.thinking).toBeUndefined()
      expect(b.output_config).toEqual({ format: 'json' })
      expect(firstPatch).toEqual({ enable_thinking: false, thinking: { type: 'enabled', budget_tokens: 2048 }, output_config: { effort: 'HIGH' }, chat_template_kwargs: { enable_thinking: true } })

      const replaced: any = payload()
      const options = (create({ output_config: { format: null } }) as any)[method]({}, {}, { onPayload: () => replaced })
      expect(await options.onPayload({}, {})).toBe(replaced)
      expect(replaced.output_config).toEqual({})

      const official: any = payload()
      await (create({ reasoning_effort: 'CUSTOM' }, 'official') as any)[method]({}, {}, {}).onPayload(official, {})
      expect(official.reasoning_effort).not.toBe('CUSTOM')
    }
  })
})

describe('first physical model fetch timing', () => {
  const timings = () => logMocks.info.mock.calls
    .filter(([message]) => message === '[FirstTextTiming]').map(([, fields]) => fields)
  const createWrapper = (traceId = 'fetch-trace') => {
    const underlying = vi.fn((_model, _context, options) => options)
    return wrapPiApiModuleWithPayloadNormalization({
      apiModule: { stream: underlying, streamSimple: underlying },
      invokeContext: { runtime: { traceId, sessionId: 'fetch-session' } } as any,
      providerApiType: 'openai-completions'
    })
  }
  const normalize = (wrapper: ReturnType<typeof createWrapper>, method: 'stream' | 'streamSimple', options?: unknown) =>
    (wrapper[method] as any)({}, {}, options)

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['stream', 'streamSimple'] as const)('%s times only the first physical fetch across normalization and concurrent calls', async method => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const wrapper = createWrapper()
    const request = new Request('https://example.test/private', { method: 'POST', body: 'private-request' })
    const signal = new AbortController().signal
    const init = Object.freeze({ signal, headers: { Authorization: 'private-key' }, body: 'private-body', method: 'POST' })
    const response = new Response('private-response', { status: 503 })
    const readBody = vi.spyOn(response, 'text')
    const clone = vi.spyOn(response, 'clone')
    let resolveFirst!: (response: Response) => void
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      .mockResolvedValue(response)
    const originalOptions = Object.freeze({ fetch, signal, maxRetries: 3, headers: init.headers })
    const first = normalize(wrapper, method, originalOptions)
    const next = normalize(wrapper, method === 'stream' ? 'streamSimple' : 'stream', originalOptions)
    expect(timings()).toEqual([])
    expect(first.signal).toBe(signal)
    expect(first.headers).toBe(init.headers)
    expect(first.maxRetries).toBe(3)
    expect(originalOptions.fetch).toBe(fetch)

    const pending = first.fetch(request, init)
    expect(timings()).toEqual([{ traceId: 'fetch-trace', sessionId: 'fetch-session', stage: 'model-fetch-start', atEpochMs: 1000 }])
    // A second request can settle first, but must not steal the first request's measurement.
    now = 1010
    expect(await next.fetch(request, init)).toBe(response)
    expect(timings()).toHaveLength(1)
    now = 1042
    resolveFirst(response)
    expect(await pending).toBe(response)
    expect(timings()).toEqual([
      { traceId: 'fetch-trace', sessionId: 'fetch-session', stage: 'model-fetch-start', atEpochMs: 1000 },
      { traceId: 'fetch-trace', sessionId: 'fetch-session', stage: 'model-fetch-headers', atEpochMs: 1042, elapsedMs: 42, status: 503 }
    ])
    expect(await first.fetch(request, init)).toBe(response)
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const args of fetch.mock.calls) {
      expect(args).toHaveLength(2)
      expect(args[0]).toBe(request)
      expect(args[1]).toBe(init)
      expect(args[1]?.signal).toBe(signal)
    }
    const laterFailure = new Error('private-later-failure')
    fetch.mockRejectedValueOnce(laterFailure)
    await expect(next.fetch(request, init)).rejects.toBe(laterFailure)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(timings()).toHaveLength(2)
    expect(readBody).not.toHaveBeenCalled()
    expect(clone).not.toHaveBeenCalled()
    expect(response.bodyUsed).toBe(false)
    expect(JSON.stringify(timings())).not.toMatch(/private|example.test|Authorization/)
  })

  it.each(['reject', 'throw', 'abort'] as const)('logs a safe first-fetch error and preserves the exact %s reason without retrying', async failureMode => {
    let now = 2000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const failure = failureMode === 'abort'
      ? new DOMException('private cancellation reason', 'AbortError')
      : new Error('private network error with credentials')
    const controller = new AbortController()
    if (failureMode === 'abort') controller.abort(failure)
    const init = { signal: controller.signal }
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      now = 2037
      if (failureMode === 'throw') throw failure
      return Promise.reject(failure)
    })
    const wrapper = createWrapper()
    const options = normalize(wrapper, 'stream', { fetch })
    await expect(options.fetch('https://example.test/private', init)).rejects.toBe(failure)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toBe(init)
    expect(timings()).toEqual([
      { traceId: 'fetch-trace', sessionId: 'fetch-session', stage: 'model-fetch-start', atEpochMs: 2000 },
      { traceId: 'fetch-trace', sessionId: 'fetch-session', stage: 'model-fetch-error', atEpochMs: 2037, elapsedMs: 37 }
    ])
    const response = new Response('not read')
    fetch.mockResolvedValueOnce(response)
    expect(await normalize(wrapper, 'streamSimple', { fetch }).fetch('https://example.test/retry', init)).toBe(response)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(timings()).toHaveLength(2)
    expect(logMocks.warn).not.toHaveBeenCalled()
    expect(logMocks.error).not.toHaveBeenCalled()
    expect(JSON.stringify(timings())).not.toMatch(/private|credentials|AbortError|example.test/)
  })

  it.each(['stream', 'streamSimple'] as const)('%s delegates to global fetch when omitted and keeps invocation measurements independent', async method => {
    const response = new Response('private-body')
    const globalFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    vi.stubGlobal('fetch', globalFetch)
    const first = createWrapper('first-invoke')
    const second = createWrapper('second-invoke')
    const request = new Request('https://example.test/private')
    const options = normalize(first, method)
    expect(globalFetch).not.toHaveBeenCalled()
    expect(await options.fetch(request)).toBe(response)
    expect(await options.fetch(request)).toBe(response)
    expect(await normalize(second, method, {}).fetch(request)).toBe(response)
    expect(globalFetch).toHaveBeenCalledTimes(3)
    for (const args of globalFetch.mock.calls) {
      expect(args).toHaveLength(1)
      expect(args[0]).toBe(request)
    }
    expect(timings().map(fields => [fields.traceId, fields.stage])).toEqual([
      ['first-invoke', 'model-fetch-start'], ['first-invoke', 'model-fetch-headers'],
      ['second-invoke', 'model-fetch-start'], ['second-invoke', 'model-fetch-headers']
    ])
    expect(response.bodyUsed).toBe(false)
  })
})

describe('Pi runtime authentication', () => {
  const runtime = (apiKey?: string) => ({
    modelInfo: { provider: { type: 'openai', apiKey, anthropicApiHost: 'https://open.vectcut.com' } },
    env: { ANTHROPIC_API_KEY: 'fresh-runtime-token', ANTHROPIC_AUTH_TOKEN: 'session-login-token' }
  }) as any

  it('uses the fresh resolved runtime token for OpenAI gateway requests instead of stale provider credentials', () => {
    expect(resolvePiRuntimeApiKey(runtime('stale-provider-token'), 'https://open.vectcut.com/v1'))
      .toBe('fresh-runtime-token')
  })

  it.each([
    'https://custom.example/v1',
    'https://open.vectcut.com.evil.example/v1',
    'https://evil.example/open.vectcut.com',
    'https://open.vectcut.com@evil.example/v1',
    'not-a-url/open.vectcut.com',
    'http://open.vectcut.com/v1'
  ])('keeps custom endpoint credentials scoped to the actual destination %s', baseUrl => {
    expect(resolvePiRuntimeApiKey(runtime('custom-api-key'), baseUrl)).toBe('custom-api-key')
    expect(resolvePiRuntimeApiKey(runtime(), baseUrl)).toBe('')
  })

  it('honors explicit custom keys even when the URL is the built-in gateway', () => {
    const environment = runtime('explicit-custom-key')
    environment.modelInfo.provider.id = 'custom-123'
    expect(resolvePiRuntimeApiKey(environment, 'https://open.vectcut.com/v1')).toBe('explicit-custom-key')
  })

  it('does not fall back to a stale provider key when gateway runtime credentials are absent', () => {
    const environment = runtime('stale-provider-token')
    environment.env = {}
    expect(resolvePiRuntimeApiKey(environment, 'https://open.vectcut.com/v1')).toBe('')
  })
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
    const wrapper = wrapPiApiModuleWithPayloadNormalization({
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

  it.each(['stream', 'streamSimple'] as const)('%s captures replaced normalized payload and only observes result without iterating', async method => {
    const collector = createTokenTelemetryCollector({ runtimeSessionId: 'r', invocationId: 'i', modelId: 'm', providerId: 'p' })
    let telemetry: TokenTelemetry | undefined
    collector.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
    let options: any
    const iterator = vi.fn(() => { throw new Error('telemetry must not iterate') })
    const stream = { result: vi.fn(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', usage: { input: 1, cacheRead: 2, cacheWrite: 0, output: 3 } })), [Symbol.asyncIterator]: iterator }
    let resolveResult: (value: any) => void = () => {}
    stream.result.mockImplementation(() => new Promise(resolve => { resolveResult = resolve }))
    const underlying = vi.fn((_model, _context, received) => { options = received; return stream })
    const wrapper = wrapPiApiModuleWithPayloadNormalization({ apiModule: { stream: underlying, streamSimple: underlying }, invokeContext: { runtime: { traceId: 'i' }, projection: {} } as any, providerApiType: 'openai-completions', tokenTelemetry: collector })
    const result = (wrapper[method] as any)({ id: 'm' }, {}, { onPayload: () => ({ messages: [call('B')], tools: [] }), fetch: async () => new Response() })
    expect(result).toBe(stream)
    await options.onPayload({ messages: [{ role: 'user', content: 'original'.repeat(1000) }] }, {})
    await options.fetch('https://example.test'); await options.fetch('https://example.test')
    expect(telemetry!.requests[0].attempts).toBe(2)
    expect(telemetry!.requests[0].input.categories.toolCalls).toBeGreaterThan(0)
    expect(telemetry!.requests[0].input.categories.toolResults).toBeGreaterThan(0)
    expect(telemetry!.requests[0].input.total).toBeLessThan(1000)
    resolveResult({ content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', usage: { input: 1, cacheRead: 2, cacheWrite: 0, output: 3 } })
    await Promise.resolve(); await Promise.resolve()
    expect(telemetry!.requests[0]).toMatchObject({ status: 'completed', reported: { inputTokens: 3, totalTokens: 6 } })
    expect(iterator).not.toHaveBeenCalled()
  })

  it.each(['stream', 'streamSimple'] as const)('%s forwards fetch and response callbacks with only scalar thinking diagnostics', async method => {
    const underlying = vi.fn((_model, _context, options) => options)
    const wrapper = wrapPiApiModuleWithPayloadNormalization({
      apiModule: { stream: underlying, streamSimple: underlying } as any,
      invokeContext: { runtime: { traceId: 'test' }, projection: { topicId: 'topic' } } as any,
      providerApiType: 'openai-completions'
    })
    const onResponse = vi.fn(async () => {})
    const fetch = vi.fn()
    const model = { id: 'model', baseUrl: 'https://example.com/v1' }
    const options = (wrapper[method] as any)(model, {}, { onResponse, fetch })
    expect(options.fetch).toEqual(expect.any(Function))
    expect(options.fetch).not.toBe(fetch)
    expect(options.onResponse).toBe(onResponse)
    await options.onPayload({ messages: [] }, model)
    const success = { status: 200 }
    await options.onResponse(success, model)
    expect(logMocks.info).toHaveBeenCalledExactlyOnceWith('[AgentCore] thinking payload', expect.objectContaining({ selectedLevel: null, enableThinking: null, thinkingType: null, effort: null }))
    expect(logMocks.warn).not.toHaveBeenCalled()
    expect(onResponse).toHaveBeenLastCalledWith(success, model)

    const failure = { status: 503 }
    await options.onResponse(failure, model)
    expect(logMocks.warn).not.toHaveBeenCalled()
    expect(onResponse).toHaveBeenLastCalledWith(failure, model)
    expect(onResponse).toHaveBeenCalledTimes(2)
    expect(logMocks.info).toHaveBeenCalledExactlyOnceWith('[AgentCore] thinking payload', expect.objectContaining({ selectedLevel: null, enableThinking: null, thinkingType: null, effort: null }))
  })

  it.each([
    ['gpt-5.6-sol', 'none'], ['gpt-5.6-sol', 'low'], ['gpt-5.6-sol', 'high'],
    ['gpt-6-astra', 'none'], ['gpt-6-astra', 'medium'], ['gpt-6-astra', 'high']
  ])('sends protocol-safe %s reasoning %s through the installed Pi adapter', async (modelId, level) => {
    const apiModule = await import('@earendil-works/pi-ai/api/openai-completions')
    const legacy = resolveModelConfig('unknown-model', 'openai-chat-completions')!.reasoning_level_map
    const source = resolveCustomReasoningMap(modelId, 'openai', legacy)
    const patch = compileCustomReasoningMap(source).evaluate(level)
    const wrapper = wrapPiApiModuleWithPayloadNormalization({
      apiModule,
      invokeContext: { thinkingLevel: level, runtime: { traceId: 'test', provider: { id: 'custom-openai' }, model: { id: modelId } }, projection: { topicId: 'topic' } } as any,
      providerApiType: 'openai-completions',
      customReasoning: { level, patch }
    })
    const bodies: any[] = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      bodies.push(body)
      if (['thinking', 'enable_thinking', 'reasoning'].some(key => key in body)) {
        return new Response(JSON.stringify({ error: { message: "Unknown parameter: 'thinking'.", param: 'thinking' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: modelId, choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const stream = (wrapper.streamSimple as any)({
      id: modelId, name: modelId, api: 'openai-completions', provider: 'openai',
      baseUrl: 'https://example.com/v1', reasoning: false, input: ['text'], compat: { supportsDeveloperRole: false },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000
    }, {
      systemPrompt: 'Local test', messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      tools: [{ name: 'local_tool', description: 'Local tool', parameters: { type: 'object', properties: {} } }]
    }, { apiKey: 'fake-local-key', fetch, maxRetries: 0 })
    const events = []
    for await (const event of stream) events.push(event)
    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(events.some(event => event.type === 'done')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(bodies[0]).toMatchObject({ model: modelId, stream: true, reasoning_effort: level, max_completion_tokens: 1000, tool_choice: 'auto' })
    expect(bodies[0].tools).toHaveLength(1)
    for (const key of ['thinking', 'enable_thinking', 'reasoning', 'temperature', 'max_tokens']) expect(bodies[0]).not.toHaveProperty(key)
  })

  it('preserves installed SDK HTTP 400 error events and records first physical fetch headers', async () => {
    const moduleName = '@earendil-works/pi-ai/api/openai-completions'
    const apiModule = await import(moduleName)
    const wrapper = wrapPiApiModuleWithPayloadNormalization({
      apiModule,
      invokeContext: { runtime: { traceId: 'test' }, projection: { topicId: 'topic' } } as any,
      providerApiType: 'openai-completions'
    })
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      error: { type: 'invalid_request_error', message: 'invalid input', param: 'messages' }
    }), { status: 400, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'backend-rejected' } }))
    const onResponse = vi.fn()
    const stream = (wrapper.streamSimple as any)({
      id: 'test-model', name: 'Test', api: 'openai-completions', provider: 'openai',
      baseUrl: 'https://example.com/v1', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000
    }, { messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] }, {
      apiKey: 'private-api-key', fetch, onResponse, maxRetries: 0
    })
    const events = []
    for await (const event of stream) events.push(event)
    expect(events.some(event => event.type === 'error')).toBe(true)
    expect(onResponse).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(logMocks.info).toHaveBeenCalledWith('[AgentCore] thinking payload', expect.objectContaining({ selectedLevel: null, enableThinking: null, thinkingType: null, effort: null }))
    const timings = logMocks.info.mock.calls.filter(([message]) => message === '[FirstTextTiming]')
    expect(timings.map(([, fields]) => fields.stage)).toEqual(['model-fetch-start', 'model-fetch-headers'])
    expect(timings[1][1]).toMatchObject({ status: 400, elapsedMs: expect.any(Number), atEpochMs: expect.any(Number) })
    expect(JSON.stringify(timings)).not.toMatch(/private-api-key|invalid input|messages|backend-rejected|example.com/)
    expect(logMocks.warn).not.toHaveBeenCalled()
  })

  it.each(['stream', 'streamSimple'] as const)('%s uses protocol-specific tool_choice defaults and preserves callback replacements', async method => {
    for (const providerApiType of ['openai-completions', 'anthropic-messages'] as const) {
      const underlying = vi.fn((_model, _context, options) => options)
      const wrapper = wrapPiApiModuleWithPayloadNormalization({
        apiModule: { stream: underlying, streamSimple: underlying } as any,
        invokeContext: { runtime: {}, projection: {} } as any,
        providerApiType
      })
      const options = (wrapper[method] as any)({}, {}, {})
      const payload: any = { tools: [{ name: 'test' }] }
      await options.onPayload(payload, {})
      expect(payload.tool_choice).toEqual(providerApiType === 'anthropic-messages' ? { type: 'auto' } : 'auto')
      for (const tools of [undefined, []]) {
        const withoutTools: any = { tools }
        await options.onPayload(withoutTools, {})
        expect(withoutTools).not.toHaveProperty('tool_choice')
      }
      const replacement: any = { tools: [{ name: 'test' }] }
      const replacing = (wrapper[method] as any)({}, {}, { onPayload: () => replacement })
      expect(await replacing.onPayload({}, {})).toBe(replacement)
      expect(replacement.tool_choice).toEqual(payload.tool_choice)
    }
  })

  it.each(['stream', 'streamSimple'] as const)('%s preserves Anthropic messages and existing parameter semantics', async method => {
    const underlying = vi.fn((_model, _context, options) => options)
    const wrapper = wrapPiApiModuleWithPayloadNormalization({
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


describe('Seed Audio MCP long-running integration', () => {
  it('keeps concurrent generation results and billing after the default 60-second deadline', async () => {
    const registry = await readFile(new URL('../tools/registry.ts', import.meta.url), 'utf8')
    const registration = registry.match(/mountMcpServer\('seed-audio',\s*(\{[\s\S]*?\})\)/)?.[1]
    expect(registration).toBeDefined()
    expect(registration).toMatch(/longRunning:\s*true/)
    expect(registration).toMatch(/timeout:\s*35\s*\*\s*60/)

    const server = new McpServer({ name: 'seed-audio', version: '1' }, { capabilities: { tools: {} } })
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'generate_seed_audio', inputSchema: { type: 'object' as const } }]
    }))
    const generate = vi.fn(async (request) => {
      const part = Number(request.params.arguments?.part)
      await new Promise(resolve => setTimeout(resolve, [95000, 100000, 105000][part]))
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        success: true, url: `https://example.com/part-${part}.wav`, billing: { consume: part + 1 }
      }) }] }
    })
    server.server.setRequestHandler(CallToolRequestSchema, generate)
    const call = vi.spyOn(Client.prototype, 'callTool')
    let clients: Awaited<ReturnType<typeof buildMcpTools>>['clients'] = []
    try {
      const built = await buildMcpTools({
        packageBridge: {} as any,
        invokeContext: {
          runtime: { workspacePath: os.tmpdir(), traceId: 'trace-seed' },
          projection: { topicId: 'topic-seed', piSessionId: 'session-seed' }
        } as any,
        options: { mcpServers: { 'seed-audio': {
          type: 'sdk', name: 'seed-audio', instance: server, longRunning: true, timeout: 35 * 60
        } } } as any
      })
      clients = built.clients
      const tool = built.tools.find(tool => tool.name === 'mcp__vectcut__seed-audio__generate_seed_audio')!
      const controller = new AbortController()
      vi.useFakeTimers()
      let completed = false
      const pending = Promise.all([0, 1, 2].map(part => tool.execute(`seed-${part}`, { part }, controller.signal)))
      void pending.then(() => { completed = true }, () => { completed = true })
      await vi.advanceTimersByTimeAsync(60001)
      expect(generate).toHaveBeenCalledTimes(3)
      expect(completed).toBe(false)
      expect(call).toHaveBeenCalledTimes(3)
      expect(call).toHaveBeenCalledWith(
        { name: 'generate_seed_audio', arguments: { part: 0 } }, undefined,
        expect.objectContaining({
          signal: controller.signal, timeout: 2100000,
          resetTimeoutOnProgress: true, maxTotalTimeout: 2100000, onprogress: expect.any(Function)
        })
      )
      await vi.advanceTimersByTimeAsync(45000)
      const results = await pending
      results.forEach((result, part) => {
        expect(JSON.parse((result.content[0] as any).text)).toMatchObject({ success: true, billing: { consume: part + 1 } })
        expect(result.details).toMatchObject({ billing: { consume: part + 1 } })
      })
    } finally {
      vi.useRealTimers()
      await Promise.allSettled(clients.map(client => client.close()))
      await server.close()
      call.mockRestore()
    }
  })
})


describe('local Blender MCP long-running integration', () => {
  it('forwards the 61-minute timeout, cancellation signal and progress options', async () => {
    const server = new McpServer({ name: 'blender-local', version: '1' }, { capabilities: { tools: {} } })
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'blender_render', inputSchema: { type: 'object' as const } }]
    }))
    const call = vi.spyOn(Client.prototype, 'callTool').mockResolvedValue({ content: [{ type: 'text', text: 'rendered' }] })
    let clients: Awaited<ReturnType<typeof buildMcpTools>>['clients'] = []
    try {
      const built = await buildMcpTools({
        packageBridge: {} as any,
        invokeContext: {
          runtime: { workspacePath: '/tmp/local-blender-test', traceId: 'trace-blender' },
          projection: { topicId: 'topic-1', piSessionId: 'session-1' }
        } as any,
        options: { mcpServers: { 'blender-local': {
          type: 'sdk', name: 'blender-local', instance: server, longRunning: true, timeout: 3660
        } } } as any
      })
      clients = built.clients
      const render = built.tools.find(tool => tool.name === 'mcp__vectcut__blender-local__blender_render')!
      const controller = new AbortController()
      await render.execute('render-1', { script: 'import bpy' }, controller.signal)
      expect(call).toHaveBeenCalledWith(
        { name: 'blender_render', arguments: { script: 'import bpy' } }, undefined,
        expect.objectContaining({
          signal: controller.signal, timeout: 3660000,
          resetTimeoutOnProgress: true, maxTotalTimeout: 3660000, onprogress: expect.any(Function)
        })
      )
    } finally {
      await Promise.allSettled(clients.map(client => client.close()))
      call.mockRestore()
    }
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


describe('builtin Read image guidance', () => {
  it.each([false, true])('matches the exposed image tool, available=%s', async available => {
    const piAi = await import('@earendil-works/pi-ai')
    const tools = buildBuiltinTools({
      packageBridge: { agentCore, agentNode, piAi } as any,
      invokeContext: {
        runtime: { workspacePath: os.tmpdir() },
        tools: { activeToolNames: available ? ['Read', 'ReadImageAsContent'] : ['Read'] }
      } as any,
      runtimeEnvironment: { env: {} } as any,
      interactiveUpdatedInputs: new Map()
    })
    const read = tools.find(tool => tool.name === 'Read')!
    if (available) {
      expect(read.description).toContain('MUST use ReadImageAsContent first')
      expect(tools.some(tool => tool.name === 'ReadImageAsContent')).toBe(true)
    } else {
      expect(read.description).not.toContain('ReadImageAsContent')
      expect(read.description).not.toContain('Images are sent as attachments')
      expect(read.description).toContain('This model does not support image input')
      expect(read.description).toContain('If an image-understanding tool is available')
      expect(read.description).toContain('otherwise explain that the current model cannot view images')
      expect(tools.map(tool => tool.name)).toEqual(['Read'])
    }
  })
})


describe('removed builtin AskUserQuestion tool', () => {
  it('does not expose the legacy builtin even when requested', async () => {
    const piAi = await import('@earendil-works/pi-ai')
    const updated = new Map<string, Record<string, unknown>>()
    const [tool] = buildBuiltinTools({
      packageBridge: { agentCore, agentNode, piAi } as any,
      invokeContext: { runtime: { workspacePath: os.tmpdir() }, tools: { activeToolNames: ['AskUserQuestion'] } } as any,
      runtimeEnvironment: { env: {} } as any,
      interactiveUpdatedInputs: updated
    })
    expect(tool).toBeUndefined()

  })
})


describe('user interaction MCP lifecycle', () => {
  it('lists rich schema and returns approved answers through real MCP transport', async () => {
    const { default: UserInteractionServer } = await import('@main/mcpServers/user-interaction')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = new UserInteractionServer()
    const client = new Client({ name: 'test', version: '1' })
    await server.mcpServer.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const listed = await client.listTools()
      expect(listed.tools[0].inputSchema.properties).toHaveProperty('questions')
      expect((await client.callTool({ name: 'AskUserQuestion', arguments: { question: 'Next?' } })).isError).toBe(true)
      const result = await client.callTool({ name: 'AskUserQuestion', arguments: { question: 'Next?', answers: { 'Next?': 'Go' } } })
      expect(JSON.parse((result.content as any)[0].text).answers).toEqual({ 'Next?': 'Go' })
    } finally { await client.close(); await server.mcpServer.close() }
  })

  it('executes approved answers through the harness MCP bridge', async () => {
    const { default: UserInteractionServer } = await import('@main/mcpServers/user-interaction')
    const server = new UserInteractionServer()
    const bridge = await buildMcpTools({
      packageBridge: {} as any,
      invokeContext: { runtime: { workspacePath: os.tmpdir(), traceId: 't' }, projection: { topicId: 't' } } as any,
      options: { mcpServers: { 'user-interaction': { type: 'sdk', name: 'user-interaction', instance: server.mcpServer } } } as any
    })
    try {
      expect(bridge.tools[0].name).toBe('mcp__vectcut__user-interaction__AskUserQuestion')
      const result = await bridge.tools[0].execute('question-call', { question: 'Next?', answers: { 'Next?': 'Go' } })
      expect(JSON.parse((result.content[0] as any).text).answers).toEqual({ 'Next?': 'Go' })
    } finally { for (const client of bridge.clients) await client.close() }
  })

  it.each([false, true])('starts before permission and uses the same id, denied=%s', async denied => {
    const events: any[] = []
    const approved = { question: 'Next?', answers: { 'Next?': 'Go' } }
    const execute = vi.fn(async (_id, args) => {
      expect(args).toEqual(approved)
      return { content: [{ type: 'text', text: 'Go' }] }
    })
    class Sandbox {
      constructor(private options: any) {}
      async execute(_code: string, context: any) {
        try { return { ok: true, value: await this.options.tools[0].execute({ question: 'Next?' }, context), output: [], calls: [] } }
        catch { return { ok: false, error: 'Denied', output: [], calls: [] } }
      }
      close() {}
    }
    const tool = buildCodemodeTool({
      packageBridge: { piAi: { Type: { Object: (v: unknown) => v, String: (v: unknown) => v } }, piCodemode: { CodemodeSandbox: Sandbox } } as any,
      mcpTools: [{ name: 'mcp__vectcut__user-interaction__AskUserQuestion', parameters: {}, execute }] as any,
      invokeContext: { runtime: { workspacePath: '/tmp', traceId: 't' }, projection: { topicId: 't' } } as any,
      pendingFileChanges: new Map(), emitNestedToolEvent: async e => { events.push(e) },
      canUseTool: async (_name, _args, context) => {
        expect(events.map(e => e.type)).toEqual(['start'])
        expect(context.toolUseID).toBe(events[0].toolCallId)
        return denied ? { behavior: 'deny', message: 'Cancelled' } : { behavior: 'allow', updatedInput: approved }
      }
    })
    const run = tool.execute('outer', { code: 'call' }, new AbortController().signal)
    if (denied) await expect(run).rejects.toThrow()
    else await run
    expect(events.filter(e => e.type === 'start')).toHaveLength(1)
    expect(events.at(-1).type).toBe(denied ? 'error' : 'success')
    expect(execute).toHaveBeenCalledTimes(denied ? 0 : 1)
  })
})


describe('bootstrap cancellation', () => {
  const context = { runtime: { workspacePath: os.tmpdir(), traceId: 'safe-trace' }, projection: { topicId: 'safe-topic' } } as any
  const build = (signal: AbortSignal, servers: any) => buildMcpTools({ packageBridge: {} as any, invokeContext: context, options: { mcpServers: servers }, signal })

  afterEach(() => vi.restoreAllMocks())

  it('rejects a pre-aborted harness without wrapping or logging an ordinary failure', async () => {
    const controller = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    controller.abort(reason)
    await expect(createClaudeCodeHarness({ invokeContext: context, signal: controller.signal } as any)).rejects.toBe(reason)
    expect(logMocks.error).not.toHaveBeenCalled()
  })

  it('preserves cancellation while native import is pending and never opens storage', async () => {
    const controller = new AbortController()
    const open = vi.spyOn(SqlitePiSessionStorage, 'openOrCreate')
    const run = createClaudeCodeHarness({ invokeContext: context, signal: controller.signal } as any)
    const reason = new DOMException('cancelled', 'AbortError')
    controller.abort(reason)
    await expect(run).rejects.toBe(reason)
    expect(open).not.toHaveBeenCalled()
    expect(logMocks.error).not.toHaveBeenCalled()
    expect(logMocks.info).toHaveBeenCalledWith('[AgentCore] bootstrap timing', expect.objectContaining({ stage: 'pi-import', cancelled: true }))
  })

  it('checks cancellation after storage recovery and does not start MCP requests', async () => {
    const controller = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    vi.spyOn(SqlitePiSessionStorage, 'openOrCreate').mockImplementationOnce(async () => {
      controller.abort(reason)
      return {} as any
    })
    const connect = vi.spyOn(Client.prototype, 'connect')
    const piAi = await import('@earendil-works/pi-ai')
    await expect(buildPiRuntimeBridge({
      packageBridge: { agentCore, agentNode, piAi, openAiCompletionsApi: { stream() {}, streamSimple() {} } },
      invokeContext: { ...context, runtime: { ...context.runtime, model: { id: 'test' } } },
      runtimeEnvironment: { env: {}, modelInfo: { provider: { type: 'openai', apiHost: 'https://example.com', apiKey: 'secret' } } },
      options: {}, pendingFileChanges: new Map(), signal: controller.signal
    } as any)).rejects.toBe(reason)
    expect(connect).not.toHaveBeenCalled()
    expect(logMocks.error).not.toHaveBeenCalled()
    expect(logMocks.info).toHaveBeenCalledWith('[AgentCore] bootstrap timing', expect.objectContaining({ stage: 'storage', cancelled: true }))
  })

  it('propagates signal to connect and listTools and logs only safe timing fields', async () => {
    const controller = new AbortController()
    const connect = vi.spyOn(Client.prototype, 'connect').mockResolvedValue()
    const list = vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] })
    vi.spyOn(Client.prototype, 'close').mockResolvedValue()
    const result = await build(controller.signal, { remote: { type: 'http', url: 'https://example.com/private', headers: { Authorization: 'secret' } } })
    expect(connect.mock.calls[0][1]).toEqual({ signal: controller.signal })
    expect(list).toHaveBeenCalledWith(undefined, { signal: controller.signal })
    const timings = logMocks.info.mock.calls.filter(([message]) => message === '[AgentCore] bootstrap timing')
    expect(timings.map(([, data]) => data.stage)).toEqual(['mcp-connect', 'mcp-listTools'])
    expect(timings.every(([, data]) => data.status === 'success')).toBe(true)
    const starts = logMocks.info.mock.calls.filter(([message]) => message === '[AgentCore] bootstrap start')
    expect(starts.map(([, data]) => data.stage)).toEqual(['mcp-connect', 'mcp-listTools'])
    expect(JSON.stringify([...starts, ...timings])).not.toMatch(/secret|example.com|private/)
    await result.clients[0].close()
  })

  it.each(['connect', 'listTools'] as const)('cleans clients on cancellation during %s and does not start the next server', async stage => {
    const controller = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    const connect = vi.spyOn(Client.prototype, 'connect').mockResolvedValue()
    const list = vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] })
    const close = vi.spyOn(Client.prototype, 'close').mockResolvedValue()
    const target = stage === 'connect' ? connect : list
    target.mockImplementationOnce(async () => { controller.abort(reason); throw reason })
    await expect(build(controller.signal, { first: { type: 'http', url: 'https://example.com' }, second: { type: 'http', url: 'https://example.org' } })).rejects.toBe(reason)
    expect(close).toHaveBeenCalled()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(logMocks.warn).not.toHaveBeenCalled()
    expect(logMocks.info).toHaveBeenCalledWith('[AgentCore] bootstrap timing', expect.objectContaining({ status: 'cancelled' }))
  })

  it('closes earlier clients when a later connection fails', async () => {
    vi.spyOn(Client.prototype, 'connect').mockResolvedValueOnce().mockRejectedValueOnce(new Error('connect failed'))
    vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] })
    const close = vi.spyOn(Client.prototype, 'close').mockResolvedValue()
    await expect(build(new AbortController().signal, { first: { type: 'http', url: 'https://example.com' }, second: { type: 'http', url: 'https://example.org' } })).rejects.toThrow('connect failed')
    expect(new Set(close.mock.instances).size).toBe(2)
    expect(logMocks.info).toHaveBeenCalledWith('[AgentCore] bootstrap timing', expect.objectContaining({ status: 'error' }))
  })

  it('cleans MCP clients if harness construction fails after successful setup', async () => {
    vi.spyOn(SqlitePiSessionStorage, 'openOrCreate').mockResolvedValue({} as any)
    vi.spyOn(Client.prototype, 'connect').mockResolvedValue()
    vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] })
    const close = vi.spyOn(Client.prototype, 'close').mockResolvedValue()
    const piAi = await import('@earendil-works/pi-ai')
    const failure = new Error('harness failed')
    await expect(buildPiRuntimeBridge({
      packageBridge: { agentCore: { ...agentCore, Session: class {}, AgentHarness: class { constructor() { throw failure } } }, agentNode, piAi, openAiCompletionsApi: {} },
      invokeContext: { ...context, runtime: { ...context.runtime, model: { id: 'test' } }, tools: { activeToolNames: [] }, prompt: { resources: { skills: [], promptTemplates: [] } } },
      runtimeEnvironment: { env: {}, modelInfo: { provider: { type: 'openai', apiHost: 'https://example.com', apiKey: 'secret' } } },
      options: { mcpServers: { remote: { type: 'http', url: 'https://example.com' } } }, pendingFileChanges: new Map()
    } as any)).rejects.toBe(failure)
    expect(close).toHaveBeenCalled()
  })

  it('checks cancellation after a non-cancellable SDK connect before requesting initialization', async () => {
    const controller = new AbortController()
    const clientConnect = vi.spyOn(Client.prototype, 'connect').mockResolvedValue()
    const close = vi.fn(async () => {})
    const reason = new DOMException('cancelled', 'AbortError')
    await expect(build(controller.signal, { sdk: { type: 'sdk', instance: { connect: async () => { controller.abort(reason) }, close } } })).rejects.toBe(reason)
    expect(clientConnect).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })
})
