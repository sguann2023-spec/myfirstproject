import { describe, expect, it } from 'vitest'

import { TextStreamAccumulator } from '../session-stream-accumulator'

describe('TextStreamAccumulator', () => {
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
})
