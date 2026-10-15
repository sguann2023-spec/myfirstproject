import { describe, expect, it } from 'vitest'

import { summarizeProviderPayload } from '../harness/provider-payload-summary'

describe('summarizeProviderPayload', () => {
  it('measures actual OpenAI messages and tool definitions without revealing their bodies', () => {
    const payload = {
      model: 'test',
      messages: [
        { role: 'system', content: 'private-system-instructions' },
        { role: 'user', content: '\u4f60\u597d' }
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'codemode',
          description: 'private-tool-description',
          parameters: { type: 'object', properties: { secret: { const: 'private-schema-value' } } }
        }
      }],
      api_key: 'private-api-key'
    }
    const summary = summarizeProviderPayload(payload)

    expect(summary.messageCount).toBe(2)
    expect(summary.toolCount).toBe(1)
    expect(summary.tools[0].name).toBe('codemode')
    expect(summary.toolsSerialized.chars).toBe(JSON.stringify(payload.tools).length)
    expect(summary.payload.bytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'))
    expect(summary.messages[1].content.bytes).toBe(8)
    const logged = JSON.stringify(summary)
    for (const secret of ['private-system-instructions', 'private-tool-description', 'private-schema-value', 'private-api-key']) {
      expect(logged).not.toContain(secret)
    }
  })

  it('measures Anthropic system blocks and input schemas', () => {
    const summary = summarizeProviderPayload({
      system: [{ type: 'text', text: 'private-system' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [{ name: 'Bash', description: 'shell', input_schema: { type: 'object' } }]
    })

    expect(summary.system.chars).toBeGreaterThan(0)
    expect(summary.tools[0].schema.chars).toBe(JSON.stringify({ type: 'object' }).length)
    expect(JSON.stringify(summary)).not.toContain('private-system')
  })

  it('handles absent messages and tools', () => {
    const summary = summarizeProviderPayload({})
    expect(summary.messageCount).toBe(0)
    expect(summary.toolCount).toBe(0)
    expect(summary.toolsSerialized.chars).toBe(0)
  })
})
