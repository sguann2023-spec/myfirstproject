import { describe, expect, it } from 'vitest'

import { TextStreamAccumulator } from '../session-stream-accumulator'

describe('TextStreamAccumulator', () => {
  it('accumulates partial arguments and parses complete JSON without a tool-call', () => {
    const accumulator = new TextStreamAccumulator()
    accumulator.add({ type: 'tool-input-start', id: 'tool-1', toolName: 'Read' } as any)
    accumulator.add({ type: 'tool-input-delta', id: 'tool-1', delta: '{"path":"' } as any)
    accumulator.add({ type: 'tool-input-delta', id: 'tool-1', delta: 'a.md' } as any)

    const partialBlock = accumulator.getAssistantBlocks('message-1')[0]
    expect(partialBlock).toMatchObject({
      type: 'tool',
      status: 'processing',
      partialArguments: '{"path":"a.md',
      metadata: { rawMcpToolResponse: { partialArguments: '{"path":"a.md' } }
    })
    expect(partialBlock.arguments).toBeUndefined()
    expect(partialBlock.metadata.rawMcpToolResponse.arguments).toBeUndefined()

    accumulator.add({ type: 'tool-input-delta', id: 'tool-1', delta: '"}' } as any)
    accumulator.add({ type: 'tool-input-end', id: 'tool-1' } as any)

    expect(accumulator.getAssistantBlocks('message-1')).toHaveLength(1)
    expect(accumulator.getAssistantBlocks('message-1')[0]).toMatchObject({
      toolName: 'Read',
      status: 'processing',
      arguments: { path: 'a.md' },
      partialArguments: '{"path":"a.md"}',
      metadata: {
        rawMcpToolResponse: { arguments: { path: 'a.md' }, partialArguments: '{"path":"a.md"}' }
      }
    })
    expect(partialBlock.partialArguments).toBe('{"path":"a.md')
  })

  it('isolates interleaved tool deltas and preserves order when a start is missing', () => {
    const accumulator = new TextStreamAccumulator()
    accumulator.add({ type: 'text-delta', text: 'Before tools' } as any)
    accumulator.add({ type: 'tool-input-delta', toolCallId: 'tool-1', delta: '{"path":' } as any)
    accumulator.add({ type: 'tool-input-start', id: 'tool-2', toolName: 'Bash' } as any)
    accumulator.add({ type: 'tool-input-delta', id: 'tool-2', delta: '{"command":"pwd"}' } as any)
    accumulator.add({ type: 'tool-input-start', id: 'tool-1', toolName: 'Read' } as any)
    accumulator.add({ type: 'tool-input-delta', toolCallId: 'tool-1', id: 'ignored-id', delta: '"a.md"}' } as any)

    const blocks = accumulator.getAssistantBlocks('message-1')
    expect(blocks.map((block) => block.toolId ?? block.content)).toEqual(['Before tools', 'tool-1', 'tool-2'])
    expect(blocks[1]).toMatchObject({ toolName: 'Read', arguments: { path: 'a.md' }, partialArguments: '{"path":"a.md"}' })
    expect(blocks[2]).toMatchObject({ toolName: 'Bash', arguments: { command: 'pwd' }, partialArguments: '{"command":"pwd"}' })
    expect(accumulator.summarizeState()).toMatchObject({ toolCallCount: 2 })
  })

  it.each([
    { input: { path: 'final.md' } },
    { args: { path: 'final.md' } },
    { providerMetadata: { raw: { input: { path: 'final.md' } } } }
  ])('prefers explicit tool-call arguments over streamed arguments: %j', (payload) => {
    const accumulator = new TextStreamAccumulator()
    accumulator.add({ type: 'tool-input-start', id: 'tool-1', toolName: 'Read' } as any)
    accumulator.add({ type: 'tool-input-delta', id: 'tool-1', delta: '{"path":"draft.md"}' } as any)
    accumulator.add({ type: 'tool-call', toolCallId: 'tool-1', ...payload } as any)

    expect(accumulator.getAssistantBlocks('message-1')[0]).toMatchObject({
      toolName: 'Read',
      arguments: { path: 'final.md' },
      partialArguments: '{"path":"draft.md"}',
      metadata: { rawMcpToolResponse: { arguments: { path: 'final.md' } } }
    })
  })

  it.each(['tool-result', 'tool-error'])('retains parsed and partial arguments after %s without final input', (type) => {
    const accumulator = new TextStreamAccumulator()
    accumulator.add({ type: 'tool-input-start', id: 'tool-1', toolName: 'Read' } as any)
    accumulator.add({ type: 'tool-input-delta', id: 'tool-1', delta: '{"path":"a.md"}' } as any)
    accumulator.add({ type: 'tool-call', toolCallId: 'tool-1' } as any)
    accumulator.add({ type, toolCallId: 'tool-1', toolName: 'Read', output: 'ok', error: 'failed' } as any)

    expect(accumulator.getAssistantBlocks('message-1')[0]).toMatchObject({
      toolName: 'Read',
      status: type === 'tool-error' ? 'error' : 'success',
      arguments: { path: 'a.md' },
      partialArguments: '{"path":"a.md"}',
      metadata: {
        rawMcpToolResponse: {
          arguments: { path: 'a.md' },
          partialArguments: '{"path":"a.md"}',
          status: type === 'tool-error' ? 'error' : 'done'
        }
      }
    })
  })

  it('keeps invalid JSON as partial arguments without throwing', () => {
    const accumulator = new TextStreamAccumulator()
    accumulator.add({ type: 'tool-input-delta', id: 'tool-1', delta: '{invalid}' } as any)

    const block = accumulator.getAssistantBlocks('message-1')[0]
    expect(block.partialArguments).toBe('{invalid}')
    expect(block.arguments).toBeUndefined()
    expect(block.metadata.rawMcpToolResponse.partialArguments).toBe('{invalid}')
    expect(block.metadata.rawMcpToolResponse.arguments).toBeUndefined()
  })

  it('ignores deltas with missing IDs or empty and non-string payloads', () => {
    const accumulator = new TextStreamAccumulator()
    accumulator.add({ type: 'tool-input-delta', delta: '{}' } as any)
    for (const delta of ['', undefined, null, 123, {}]) {
      accumulator.add({ type: 'tool-input-delta', id: 'ignored-tool', delta } as any)
    }
    expect(accumulator.getAssistantBlocks('message-1')).toEqual([])

    accumulator.add({ type: 'tool-input-start', id: 'tool-1', toolName: 'Read' } as any)
    accumulator.add({ type: 'tool-input-delta', id: 'tool-1', delta: '{"path":' } as any)
    accumulator.add({ type: 'tool-input-delta', id: 'tool-1', delta: 123 } as any)
    accumulator.add({ type: 'tool-input-delta', id: 'tool-1', delta: '"a.md"}' } as any)
    expect(accumulator.getAssistantBlocks('message-1')[0].arguments).toEqual({ path: 'a.md' })
  })

  it('persists thinking blocks into assistant blocks', () => {
    const accumulator = new TextStreamAccumulator()

    accumulator.add({ type: 'reasoning-start', id: 'reasoning-1' } as any)
    accumulator.add({ type: 'reasoning-delta', id: 'reasoning-1', text: '先分析需求' } as any)
    accumulator.add({ type: 'reasoning-end', id: 'reasoning-1' } as any)
    accumulator.add({ type: 'text-start', id: 'text-1' } as any)
    accumulator.add({ type: 'text-delta', id: 'text-1', text: '最终回答' } as any)
    accumulator.add({ type: 'text-end', id: 'text-1' } as any)

    const blocks = accumulator.getAssistantBlocks('message-1', 'openai:qwen3.7-plus')

    expect(blocks.find((block) => block.type === 'thinking')).toMatchObject({
      type: 'thinking',
      content: '先分析需求',
      thinking_millsec: 0
    })
    expect(blocks.find((block) => block.type === 'main_text')).toMatchObject({
      type: 'main_text',
      content: '最终回答'
    })
  })

  it('keeps text and tool blocks in streamed order when text ends after tool start', () => {
    const accumulator = new TextStreamAccumulator()

    accumulator.add({ type: 'text-start', id: 'text-1' } as any)
    accumulator.add({ type: 'text-delta', id: 'text-1', text: '文件存在，现在上传到 OSS。' } as any)
    accumulator.add({ type: 'tool-input-start', id: 'tool-1', toolName: 'upload_file' } as any)
    accumulator.add({ type: 'tool-call', toolCallId: 'tool-1', toolName: 'upload_file', input: { path: 'a.md' } } as any)
    accumulator.add({ type: 'tool-result', toolCallId: 'tool-1', output: 'https://example.com/a.md' } as any)
    accumulator.add({ type: 'text-end', id: 'text-1' } as any)

    accumulator.add({ type: 'text-start', id: 'text-2' } as any)
    accumulator.add({ type: 'text-delta', id: 'text-2', text: '下载完成，现在对比两个文件内容是否一致。' } as any)
    accumulator.add({ type: 'tool-input-start', id: 'tool-2', toolName: 'Bash' } as any)
    accumulator.add({ type: 'tool-call', toolCallId: 'tool-2', toolName: 'Bash', input: { command: 'diff a.md b.md' } } as any)
    accumulator.add({ type: 'tool-result', toolCallId: 'tool-2', output: '文件内容完全一致' } as any)
    accumulator.add({ type: 'text-end', id: 'text-2' } as any)

    const blocks = accumulator.getAssistantBlocks('message-1', 'openai:qwen3.7-plus')

    expect(
      blocks.map((block) =>
        block.type === 'tool' ? `${block.type}:${block.toolName}` : `${block.type}:${block.content}`
      )
    ).toEqual([
      'main_text:文件存在，现在上传到 OSS。',
      'tool:upload_file',
      'main_text:下载完成，现在对比两个文件内容是否一致。',
      'tool:Bash'
    ])
  })

  it.each(['text', 'tool', 'text-and-tool'])('includes every trailing text delta after %s when cancelled before text-end', (prefix) => {
    const accumulator = new TextStreamAccumulator()
    const expectedPrefix: string[] = []
    if (prefix !== 'tool') {
      accumulator.add({ type: 'text-start', id: 'text-1' } as any)
      accumulator.add({ type: 'text-delta', id: 'text-1', text: 'First paragraph. ' } as any)
      accumulator.add({ type: 'text-end', id: 'text-1' } as any)
      expectedPrefix.push('First paragraph. ')
    }
    if (prefix !== 'text') {
      accumulator.add({ type: 'tool-call', toolCallId: 'tool-1', toolName: 'Read', input: { path: 'a.md' } } as any)
      accumulator.add({ type: 'tool-result', toolCallId: 'tool-1', output: 'file contents' } as any)
      expectedPrefix.push('tool-1')
    }
    accumulator.add({ type: 'text-start', id: 'text-2' } as any)
    let tail = ''
    for (const delta of ['Second', ' paragraph.', '\n']) {
      accumulator.add({ type: 'text-delta', id: 'text-2', text: delta } as any)
      tail += delta
      const state = accumulator.summarizeState()
      const blocks = accumulator.getAssistantBlocks('message-1', 'model-1')
      expect(blocks.map((block) => block.toolId ?? block.content)).toEqual([...expectedPrefix, tail])
      expect(blocks[blocks.length - 1]).toMatchObject({
        messageId: 'message-1', type: 'main_text', status: 'success', modelId: 'model-1', content: tail
      })
      expect(accumulator.summarizeState()).toEqual(state)
    }

    // Cancellation can stop the stream without text-end or finish.
    expect(accumulator.getAssistantBlocks('message-1').map((block) => block.toolId ?? block.content))
      .toEqual([...expectedPrefix, tail])
    expect(accumulator.getText()).toBe((expectedPrefix.includes('First paragraph. ') ? 'First paragraph. ' : '') + 'Second paragraph.')

    accumulator.add({ type: 'text-end', id: 'text-2' } as any)
    expect(accumulator.getAssistantBlocks('message-1').map((block) => block.toolId ?? block.content))
      .toEqual([...expectedPrefix, tail])
  })

  it('keeps snapshot reads from flushing text before provider text-end replacement', () => {
    const accumulator = new TextStreamAccumulator()
    accumulator.add({ type: 'tool-input-start', id: 'tool-1', toolName: 'Read' } as any)
    accumulator.add({ type: 'text-start', id: 'text-1' } as any)
    accumulator.add({ type: 'text-delta', id: 'text-1', text: 'Draft' } as any)
    expect(accumulator.getAssistantBlocks('message-1').map((block) => block.toolId ?? block.content))
      .toEqual(['tool-1', 'Draft'])

    accumulator.add({ type: 'text-end', id: 'text-1', providerMetadata: { text: { value: 'Final' } } } as any)
    expect(accumulator.getAssistantBlocks('message-1').map((block) => block.toolId ?? block.content))
      .toEqual(['tool-1', 'Final'])
    expect(accumulator.getText()).toBe('Final')

    accumulator.add({ type: 'text-start', id: 'text-2' } as any)
    accumulator.add({ type: 'text-delta', id: 'text-2', text: 'Tail' } as any)
    expect(accumulator.getAssistantBlocks('message-1').map((block) => block.toolId ?? block.content))
      .toEqual(['tool-1', 'Final', 'Tail'])
    accumulator.add({ type: 'tool-input-start', id: 'tool-2', toolName: 'Bash' } as any)
    expect(accumulator.getAssistantBlocks('message-1').map((block) => block.toolId ?? block.content))
      .toEqual(['tool-1', 'Final', 'Tail', 'tool-2'])
  })

  it('persists failed tool calls as error blocks', () => {
    const accumulator = new TextStreamAccumulator()
    const error = {
      content: [
        {
          type: 'text',
          text: 'cat: subtitle.json: No such file or directory'
        }
      ]
    }

    accumulator.add({ type: 'tool-input-start', id: 'tool-error-1', toolName: 'Bash' } as any)
    accumulator.add({
      type: 'tool-call',
      toolCallId: 'tool-error-1',
      toolName: 'Bash',
      input: { command: 'cat subtitle.json' }
    } as any)
    accumulator.add({
      type: 'tool-error',
      toolCallId: 'tool-error-1',
      toolName: 'Bash',
      input: { command: 'cat subtitle.json' },
      error,
      rawError: error
    } as any)

    const blocks = accumulator.getAssistantBlocks('message-1', 'openai:glm-5.3')
    const toolBlock = blocks.find((block) => block.type === 'tool')

    expect(accumulator.summarizeState()).toMatchObject({
      toolCallCount: 1,
      toolResultCount: 1
    })
    expect(toolBlock).toMatchObject({
      type: 'tool',
      status: 'error',
      toolName: 'Bash',
      content: error,
      error: {
        message: 'Tool execution failed/error',
        details: error
      },
      metadata: {
        rawMcpToolResponse: {
          status: 'error',
          response: error,
          responseRaw: error
        }
      }
    })
  })

  it('accumulates token usage across agent steps', () => {
    const accumulator = new TextStreamAccumulator()

    accumulator.add({
      type: 'finish-step',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        inputTokenDetails: {
          cacheReadTokens: 40,
          cacheWriteTokens: 10
        }
      }
    } as any)
    accumulator.add({
      type: 'finish',
      totalUsage: {
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        inputTokenDetails: {
          cacheReadTokens: 5,
          cacheWriteTokens: 0
        }
      }
    } as any)

    expect(accumulator.getUsage()).toEqual({
      prompt_tokens: 120,
      completion_tokens: 60,
      total_tokens: 180,
      cache_read_input_tokens: 45,
      cache_creation_input_tokens: 10,
      prompt_tokens_details: {
        cached_tokens: 45,
        cache_creation_input_tokens: 10,
        cache_write_tokens: 10
      },
      input_tokens_details: {
        cached_tokens: 45,
        cache_creation_input_tokens: 10,
        cache_write_tokens: 10
      }
    })
    expect(accumulator.getUsageSteps()).toEqual([
      {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 10,
        prompt_tokens_details: {
          cached_tokens: 40,
          cache_creation_input_tokens: 10,
          cache_write_tokens: 10
        },
        input_tokens_details: {
          cached_tokens: 40,
          cache_creation_input_tokens: 10,
          cache_write_tokens: 10
        }
      },
      {
        prompt_tokens: 20,
        completion_tokens: 10,
        total_tokens: 30,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 0,
        prompt_tokens_details: {
          cached_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_write_tokens: 0
        },
        input_tokens_details: {
          cached_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_write_tokens: 0
        }
      }
    ])
  })

  it('does not double count preview usage before a step finishes', () => {
    const accumulator = new TextStreamAccumulator()

    accumulator.add({
      type: 'usage',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      }
    } as any)
    accumulator.add({
      type: 'finish-step',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      }
    } as any)
    accumulator.add({
      type: 'usage',
      usage: {
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30
      }
    } as any)
    accumulator.add({
      type: 'finish',
      totalUsage: {
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30
      }
    } as any)

    expect(accumulator.getUsage()).toEqual({
      prompt_tokens: 120,
      completion_tokens: 60,
      total_tokens: 180,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      prompt_tokens_details: {
        cached_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_write_tokens: 0
      },
      input_tokens_details: {
        cached_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_write_tokens: 0
      }
    })
  })

  it('does not double count identical finish-step and finish usage', () => {
    const accumulator = new TextStreamAccumulator()

    accumulator.add({
      type: 'finish-step',
      usage: {
        inputTokens: 325,
        outputTokens: 351,
        totalTokens: 39844,
        inputTokenDetails: {
          cacheReadTokens: 39168,
          cacheWriteTokens: 0
        }
      }
    } as any)
    accumulator.add({
      type: 'finish',
      totalUsage: {
        inputTokens: 325,
        outputTokens: 351,
        totalTokens: 39844,
        inputTokenDetails: {
          cacheReadTokens: 39168,
          cacheWriteTokens: 0
        }
      }
    } as any)

    expect(accumulator.getUsage()).toEqual({
      prompt_tokens: 325,
      completion_tokens: 351,
      total_tokens: 39844,
      cache_read_input_tokens: 39168,
      cache_creation_input_tokens: 0,
      prompt_tokens_details: {
        cached_tokens: 39168,
        cache_creation_input_tokens: 0,
        cache_write_tokens: 0
      },
      input_tokens_details: {
        cached_tokens: 39168,
        cache_creation_input_tokens: 0,
        cache_write_tokens: 0
      }
    })
    expect(accumulator.getUsageSteps()).toHaveLength(1)
  })
})
