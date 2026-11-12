import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentHarness, InMemorySessionStorage, Session } from '@earendil-works/pi-agent-core'
import { buildImageInputGuidance, createReadImageContextProjector } from '../harness/read-image-context'

const base64 = Buffer.from('original image bytes').toString('base64')
const imageResult = (id = 'image-1', toolName = 'ReadImageAsContent'): any => ({
  role: 'toolResult', toolCallId: id, toolName, isError: false, timestamp: 1,
  content: [{ type: 'text', text: 'Loaded image' }, { type: 'image', data: base64, mimeType: 'image/png' }],
  details: { source: 'data-url', mimeType: 'image/png', byteLength: 20 }
})
const assistant = (stopReason = 'stop', content: unknown[] = [{ type: 'text', text: 'image described' }]): any => ({
  role: 'assistant', stopReason, content, api: 'openai-completions', provider: 'test', model: 'test', timestamp: 1,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
})
let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'read-image-context-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

it('guides text-only models to discover image understanding for user image references', () => {
  const guidance = buildImageInputGuidance(false)
  expect(guidance).toContain('image-understand / inspect_image via codemode')
  expect(guidance).toContain('image set to that path or URL')
  expect(guidance).toContain('question set to the visual question')
  expect(guidance).toContain('file://')
  expect(guidance).toContain('Do not use Read, ReadImageAsContent, shell commands, or base64')
  expect(buildImageInputGuidance(true)).toBe('')
})

it.each([false, true])('matches historical image reload guidance to model capability=%s', async supportsImageInput => {
  const result = imageResult()
  const projected = await createReadImageContextProjector(directory, undefined, {
    beginNewTurn: true, supportsImageInput
  })([result])
  const message = projected[0] as any
  const text = message.content[1].text
  if (supportsImageInput) {
    expect(text).toContain('Use ReadImageAsContent')
    expect(text).not.toContain('inspect_image')
  } else {
    expect(text).toContain('image-understand / inspect_image via codemode')
    expect(text).not.toContain('ReadImageAsContent')
  }
  expect(await readFile(message.details.source)).toEqual(Buffer.from(base64, 'base64'))
  expect(result.content[1].data).toBe(base64)
})

it('keeps images for the immediately following model call', async () => {
  const result = imageResult()
  const messages = [assistant('toolUse'), result]
  const projected = await createReadImageContextProjector(directory)(messages)
  expect(projected[1]).toBe(result)
  expect(JSON.stringify(projected)).toContain(base64)
  expect(await readdir(directory)).toEqual([])
})

it.each(['error', 'aborted'])('keeps images on %s retries until a successful response', async reason => {
  const result = imageResult()
  const messages = [result, assistant(reason), { role: 'user', content: 'retry', timestamp: 1 } as any]
  const projected = await createReadImageContextProjector(directory)(messages)
  expect(projected[0]).toBe(result)
  expect(JSON.stringify(projected)).toContain(base64)
})

it.each(['stop', 'toolUse', 'length'])('replaces consumed images after %s with reloadable original files', async reason => {
  const result = imageResult()
  const project = createReadImageContextProjector(directory)
  const projected = await project([result, assistant(reason)])
  const message = projected[0] as any
  expect(message.content.every((part: any) => part.type === 'text')).toBe(true)
  expect(message.content[0]).toEqual(result.content[0])
  expect(message.toolCallId).toBe(result.toolCallId)
  expect(message.toolName).toBe(result.toolName)
  expect(message.isError).toBe(false)
  expect(message.content[1].text).toContain('ReadImageAsContent')
  expect(await readFile(message.details.source)).toEqual(Buffer.from(base64, 'base64'))
  expect(JSON.stringify(projected)).not.toContain(base64)
  expect(result.content[1].data).toBe(base64)
  expect((await project([result, assistant(reason)]))[0]).toBe(message)
  expect(await readdir(path.join(directory, '.tool-results'))).toHaveLength(1)
})

it('retains fresh images while retiring older images and leaves other tools and user attachments alone', async () => {
  const old = imageResult('old')
  const fresh = imageResult('fresh')
  const other = imageResult('other', 'UnrelatedTool')
  const user = { role: 'user', content: [{ type: 'image', data: base64, mimeType: 'image/png' }], timestamp: 1 } as any
  const projected = await createReadImageContextProjector(directory)([user, other, old, assistant('toolUse'), fresh])
  expect(projected[0]).toBe(user)
  expect(projected[1]).toBe(other)
  expect(projected[2]).not.toBe(old)
  expect(projected[4]).toBe(fresh)
})

it('also removes historical data URLs from tool call arguments without mutating stored messages', async () => {
  const dataUrl = `data:image/png;base64,${base64}`
  const call = assistant('toolUse', [{ type: 'toolCall', name: 'ReadImageAsContent', id: 'image-1', arguments: { data_url: dataUrl, extra: true } }])
  const result = imageResult()
  const project = createReadImageContextProjector(directory)
  expect(JSON.stringify(await project([call, result]))).toContain(dataUrl)
  const projected = await project([call, result, assistant()])
  expect(JSON.stringify(projected)).not.toContain(base64)
  const args = (projected[0] as any).content[0].arguments
  expect(args.extra).toBe(true)
  expect(args.data_url).toBe((projected[1] as any).details.source)
  expect(call.content[0].arguments.data_url).toBe(dataUrl)
})

it('applies the lifecycle across actual Pi model calls without deleting session history', async () => {
  const session = new Session(new InMemorySessionStorage())
  const requests: string[] = []
  const harness = new AgentHarness({
    session, model: { id: 'test', provider: 'test', api: 'openai-completions' },
    models: { streamSimple: async (_model: unknown, context: unknown) => {
      requests.push(JSON.stringify(context))
      const message = requests.length === 1
        ? assistant('toolUse', [{ type: 'toolCall', id: 'image-1', name: 'ReadImageAsContent', arguments: {} }]) : assistant()
      return { async *[Symbol.asyncIterator]() { yield { type: 'done', reason: message.stopReason, message } }, result: async () => message }
    } },
    tools: [{ name: 'ReadImageAsContent', description: 'test', parameters: { type: 'object', properties: {} },
      execute: async () => ({ content: imageResult().content, details: imageResult().details }) }]
  } as any)
  const project = createReadImageContextProjector(directory)
  harness.on('context', async context => ({ messages: await project(context.messages) }))
  await harness.prompt('look at this image')
  expect(requests[1]).toContain(base64)
  await harness.prompt('follow up')
  expect(requests[2]).not.toContain(base64)
  expect(requests[2]).toContain('Previously loaded image')
  expect(JSON.stringify(await session.buildContext())).toContain(base64)
})

it.each(['array', 'envelope', 'encoded-envelope'] as const)('repairs %s image results restored as canonical JSON text', async format => {
  const raw = imageResult()
  const text = format === 'array' ? JSON.stringify(raw.content)
    : format === 'envelope' ? JSON.stringify({ content: raw.content, details: raw.details })
      : JSON.stringify(JSON.stringify({ content: raw.content, details: raw.details }))
  const restored = { ...raw, content: [{ type: 'text', text }], details: { rawOutput: raw, status: 'completed' } }
  const onSummary = vi.fn()
  const project = createReadImageContextProjector(directory, onSummary)
  const active = await project([assistant('toolUse'), restored])
  expect((active[1] as any).content[1]).toEqual(raw.content[1])
  const output = await project([assistant('toolUse'), restored, assistant()])
  expect(JSON.stringify(output)).not.toContain(base64)
  expect((output[1] as any).details).not.toHaveProperty('rawOutput')
  expect(await readFile((output[1] as any).details.source)).toEqual(Buffer.from(base64, 'base64'))
  expect(onSummary).toHaveBeenLastCalledWith(expect.objectContaining({
    restoredImageResults: 1, retiredImageResults: 1, remainingReadImageBase64Bytes: 0
  }))
  expect(restored.content[0].text).toBe(text)
})

it('supports builtin-prefixed historical calls and removes their data URL arguments', async () => {
  const call = assistant('toolUse', [{ type: 'toolCall', name: 'builtin_ReadImageAsContent', id: 'image-1',
    arguments: { data_url: `data:image/png;base64,${base64}` } }])
  const result = imageResult('image-1', 'builtin_ReadImageAsContent')
  const output = await createReadImageContextProjector(directory)([call, result, assistant()])
  expect(JSON.stringify(output)).not.toContain(base64)
  expect((output[1] as any).toolName).toBe('builtin_ReadImageAsContent')
})

it('does not reinterpret unrelated tool JSON or invalid image placeholders', async () => {
  const raw = imageResult('other', 'UnrelatedTool')
  const other = { ...raw, content: [{ type: 'text', text: JSON.stringify(raw.content) }] }
  const placeholder = { ...imageResult(), content: [{ type: 'text', text: JSON.stringify([
    { type: 'image', data: '[image base64 omitted]', mimeType: 'image/png' }
  ]) }] }
  const output = await createReadImageContextProjector(directory)([other, placeholder, assistant()])
  expect(output[0]).toBe(other)
  expect(output[1]).toBe(placeholder)
})

it('retires existing failed-turn images while preserving images loaded during the current turn and its retries', async () => {
  const old = imageResult('old')
  const fresh = imageResult('fresh')
  const summary = vi.fn()
  const project = createReadImageContextProjector(directory, summary, { beginNewTurn: true })
  const oldMessages = [old, assistant('error'), { role: 'user', content: 'new turn', timestamp: 2 } as any]
  const first = await project(oldMessages)
  expect(JSON.stringify(first)).not.toContain(base64)
  expect(summary).toHaveBeenLastCalledWith(expect.objectContaining({ retiredHistoricalImageResults: 1 }))
  const retry = await project([...oldMessages, assistant('toolUse'), fresh, assistant('error')])
  expect(JSON.stringify(retry[0])).not.toContain(base64)
  expect(retry[4]).toBe(fresh)
  expect(JSON.stringify(retry[4])).toContain(base64)
})

it('repairs canonical call-before-result ordering on the first request of a new turn', async () => {
  const raw = imageResult()
  const restored = { ...raw, content: [{ type: 'text', text: JSON.stringify({ content: raw.content, details: raw.details }) }] }
  const call = assistant('stop', [{ type: 'text', text: 'prior answer' }, {
    type: 'toolCall', id: 'image-1', name: 'ReadImageAsContent', arguments: { data_url: `data:image/png;base64,${base64}` }
  }])
  const project = createReadImageContextProjector(directory, undefined, { beginNewTurn: true })
  const output = await project([call, restored, { role: 'user', content: 'continue', timestamp: 2 } as any])
  expect(JSON.stringify(output)).not.toContain(base64)
  expect(await readFile((output[1] as any).details.source)).toEqual(Buffer.from(base64, 'base64'))
})

it.each(['Read', 'builtin_Read'])('retires historical %s images at a new turn and preserves newly loaded images', async toolName => {
  const old = imageResult('old-read', toolName)
  const project = createReadImageContextProjector(directory, undefined, { beginNewTurn: true })
  const output = await project([old, assistant('error')])
  expect(JSON.stringify(output)).not.toContain(base64)
  expect((output[0] as any).toolName).toBe(toolName)
  expect(await readFile((output[0] as any).details.source)).toEqual(Buffer.from(base64, 'base64'))
  const fresh = imageResult('new-read', toolName)
  const next = await project([old, assistant('toolUse'), fresh])
  expect(next[2]).toBe(fresh)
  const retried = await project([old, assistant('toolUse'), fresh, assistant('error')])
  expect(retried[2]).toBe(fresh)
  const consumed = await project([old, assistant('toolUse'), fresh, assistant()])
  expect(JSON.stringify(consumed)).not.toContain(base64)
})

it('handles fourteen native Read images from a historical conversation, without removing text-only reads', async () => {
  const images = Array.from({ length: 14 }, (_, index) => imageResult(`read-${index}`, 'Read'))
  const textRead = { ...imageResult('text-read', 'Read'), content: [{ type: 'text', text: 'source file contents' }] }
  const summary = vi.fn()
  const output = await createReadImageContextProjector(directory, summary, { beginNewTurn: true })([...images, textRead])
  expect(JSON.stringify(output)).not.toContain(base64)
  expect(output[14]).toBe(textRead)
  expect(summary).toHaveBeenCalledWith(expect.objectContaining({
    retiredHistoricalImageResults: 14, remainingReadImageBase64Bytes: 0, remainingOtherImageBase64Bytes: 0
  }))
})

it('applies native Read history projection to the actual Pi request context', async () => {
  const session = new Session(new InMemorySessionStorage())
  const old = imageResult('old-read', 'Read')
  await session.appendMessage(old)
  await session.appendMessage(assistant('error'))
  const requests: string[] = []
  const harness = new AgentHarness({
    session, model: { id: 'test', provider: 'test', api: 'openai-completions' }, tools: [],
    models: { streamSimple: async (_model: unknown, context: unknown) => {
      requests.push(JSON.stringify(context))
      const message = assistant()
      return { async *[Symbol.asyncIterator]() { yield { type: 'done', reason: 'stop', message } }, result: async () => message }
    } }
  } as any)
  const project = createReadImageContextProjector(directory, undefined, { beginNewTurn: true })
  harness.on('context', async context => ({ messages: await project(context.messages) }))
  await harness.prompt('continue the historical conversation')
  expect(requests).toHaveLength(1)
  expect(requests[0]).not.toContain(base64)
  expect(requests[0]).toContain('Previously loaded image')
  expect(JSON.stringify(await session.buildContext())).toContain(base64)
})
