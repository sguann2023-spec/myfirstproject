import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import MessageTokens from '../MessageTokens'

const mockState = {
  messages: {
    entities: {}
  },
  messageBlocks: {
    entities: {}
  }
}

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState)
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    LOCATE_MESSAGE: 'LOCATE_MESSAGE'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

vi.mock('i18next', () => ({
  t: (key: string) => {
    if (key === 'settings.messages.estimated_price') {
      return '预估花费'
    }
    return key
  }
}))

describe('MessageTokens', () => {
  it('在存在 usageSteps 时优先按 step 聚合展示', () => {
    mockState.messageBlocks.entities = {}

    const html = renderToStaticMarkup(
      <MessageTokens
        message={
          {
            id: 'assistant-1',
            role: 'assistant',
            assistantId: 'agent-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: 'success',
            blocks: [],
            usage: {
              prompt_tokens: 325,
              completion_tokens: 351,
              total_tokens: 39844
            },
            usageSteps: [
              {
                prompt_tokens: 1200,
                completion_tokens: 300,
                total_tokens: 1500,
                cache_read_input_tokens: 200
              },
              {
                prompt_tokens: 800,
                completion_tokens: 200,
                total_tokens: 1000,
                cache_read_input_tokens: 50
              }
            ]
          } as any
        }
      />
    )

    expect(html).toContain('Tokens:')
    expect(html).toContain('2.50K')
    expect(html).toContain('2.00K')
    expect(html).toContain('500')
    expect(html).toContain('缓存命中 250')
  })

  it('在没有 usageSteps 时回退到最终 usage', () => {
    mockState.messageBlocks.entities = {}

    const html = renderToStaticMarkup(
      <MessageTokens
        message={
          {
            id: 'assistant-2',
            role: 'assistant',
            assistantId: 'agent-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: 'success',
            blocks: [],
            usage: {
              prompt_tokens: 261780,
              completion_tokens: 2533,
              total_tokens: 264313
            }
          } as any
        }
      />
    )

    expect(html).toContain('Tokens:')
    expect(html).toContain('264.31K')
    expect(html).toContain('261.78K')
    expect(html).toContain('2.53K')
  })

  it('在中止场景只有 metrics 时也显示已生成 token', () => {
    mockState.messageBlocks.entities = {}

    const html = renderToStaticMarkup(
      <MessageTokens
        message={
          {
            id: 'assistant-4',
            role: 'assistant',
            assistantId: 'agent-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: 'error',
            blocks: [],
            metrics: {
              completion_tokens: 704,
              time_completion_millsec: 1000
            }
          } as any
        }
      />
    )

    expect(html).toContain('Tokens:')
    expect(html).toContain('704')
  })

  it('预估花费按 usageSteps 逐步累加，而不是按聚合 token 重算', () => {
    mockState.messageBlocks.entities = {}

    const html = renderToStaticMarkup(
      <MessageTokens
        message={
          {
            id: 'assistant-3',
            role: 'assistant',
            assistantId: 'agent-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: 'success',
            blocks: [],
            model: {
              pricing: {
                precise_uncached_input_resource_points_per_unit: 1000000,
                precise_output_resource_points_per_unit: 1000000
              }
            },
            usageSteps: [
              {
                prompt_tokens: 1,
                completion_tokens: 0,
                total_tokens: 1
              },
              {
                prompt_tokens: 0,
                completion_tokens: 2,
                total_tokens: 2
              }
            ]
          } as any
        }
      />
    )

    expect(html).toContain('预估消耗')
    expect(html).toContain('3.00')
  })

  it('会把 MCP tool 返回的 billing 点数累计进预估消耗', () => {
    mockState.messages.entities = {}
    mockState.messageBlocks.entities = {
      'tool-block-1': {
        id: 'tool-block-1',
        type: 'tool',
        toolId: 'tool-1',
        metadata: {
          rawMcpToolResponse: {
            response: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    billing: {
                      total_consumed_points: 1.25
                    }
                  })
                }
              ]
            }
          }
        }
      }
    }

    const html = renderToStaticMarkup(
      <MessageTokens
        message={
          {
            id: 'assistant-5',
            role: 'assistant',
            assistantId: 'agent-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: 'success',
            blocks: ['tool-block-1'],
            model: {
              pricing: {
                precise_uncached_input_resource_points_per_unit: 1000000,
                precise_output_resource_points_per_unit: 1000000
              }
            },
            usageSteps: [
              {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3
              }
            ]
          } as any
        }
      />
    )

    expect(html).toContain('4.25')
  })

  it('会解析字符串化的 MCP tool response billing', () => {
    mockState.messages.entities = {}
    mockState.messageBlocks.entities = {
      'tool-block-1': {
        id: 'tool-block-1',
        type: 'tool',
        toolId: 'tool-1',
        metadata: {
          rawMcpToolResponse: {
            tool: {
              name: 'mcp__image-understand__inspect_image'
            },
            response: JSON.stringify({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    billing: {
                      total_consumed_points: 2.14
                    }
                  })
                }
              ]
            })
          }
        }
      }
    }

    const html = renderToStaticMarkup(
      <MessageTokens
        message={
          {
            id: 'assistant-6',
            role: 'assistant',
            assistantId: 'agent-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: 'success',
            blocks: ['tool-block-1'],
            model: {
              pricing: {
                precise_uncached_input_resource_points_per_unit: 1000000,
                precise_output_resource_points_per_unit: 1000000
              }
            },
            usageSteps: [
              {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3
              }
            ]
          } as any
        }
      />
    )

    expect(html).toContain('5.14')
  })

  it('优先从 responseRaw 里解析 MCP tool billing', () => {
    mockState.messages.entities = {}
    mockState.messageBlocks.entities = {
      'tool-block-1': {
        id: 'tool-block-1',
        type: 'tool',
        toolId: 'tool-1',
        metadata: {
          rawMcpToolResponse: {
            tool: {
              name: 'mcp__image-understand__inspect_image'
            },
            response: {
              content: [
                {
                  type: 'text',
                  text: '{"note":"trimmed"}'
                }
              ]
            },
            responseRaw: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    billing: {
                      total_consumed_points: 1.46
                    }
                  })
                }
              ]
            }
          }
        }
      }
    }

    const html = renderToStaticMarkup(
      <MessageTokens
        message={
          {
            id: 'assistant-7',
            role: 'assistant',
            assistantId: 'agent-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: 'success',
            blocks: ['tool-block-1'],
            model: {
              pricing: {
                precise_uncached_input_resource_points_per_unit: 1000000,
                precise_output_resource_points_per_unit: 1000000
              }
            },
            usageSteps: [
              {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3
              }
            ]
          } as any
        }
      />
    )

    expect(html).toContain('4.46')
  })

  it('会优先使用 store 中最新 message 的 tool blocks', () => {
    mockState.messages.entities = {
      'assistant-8': {
        id: 'assistant-8',
        role: 'assistant',
        assistantId: 'agent-1',
        topicId: 'topic-1',
        createdAt: new Date().toISOString(),
        status: 'success',
        blocks: ['tool-block-2'],
        model: {
          pricing: {
            precise_uncached_input_resource_points_per_unit: 1000000,
            precise_output_resource_points_per_unit: 1000000
          }
        },
        usageSteps: [
          {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3
          }
        ]
      }
    }
    mockState.messageBlocks.entities = {
      'tool-block-2': {
        id: 'tool-block-2',
        type: 'tool',
        toolId: 'tool-2',
        metadata: {
          rawMcpToolResponse: {
            tool: {
              name: 'mcp__image-understand__inspect_image'
            },
            responseRaw: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    billing: {
                      total_consumed_points: 1.5
                    }
                  })
                }
              ]
            }
          }
        }
      }
    }

    const html = renderToStaticMarkup(
      <MessageTokens
        message={
          {
            id: 'assistant-8',
            role: 'assistant',
            assistantId: 'agent-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: 'success',
            blocks: [],
            model: {
              pricing: {
                precise_uncached_input_resource_points_per_unit: 1000000,
                precise_output_resource_points_per_unit: 1000000
              }
            },
            usageSteps: [
              {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3
              }
            ]
          } as any
        }
      />
    )

    expect(html).toContain('4.50')
  })

  it('会兼容 message.blocks 直接保存 block 对象的场景', () => {
    mockState.messages.entities = {}
    mockState.messageBlocks.entities = {}

    const html = renderToStaticMarkup(
      <MessageTokens
        message={
          {
            id: 'assistant-9',
            role: 'assistant',
            assistantId: 'agent-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: 'success',
            blocks: [
              {
                id: 'inline-tool-block',
                type: 'tool',
                toolName: 'mcp__image-understand__inspect_image',
                metadata: {
                  rawMcpToolResponse: {
                    responseRaw: {
                      content: [
                        {
                          type: 'text',
                          text: JSON.stringify({
                            billing: {
                              total_consumed_points: 1.5
                            }
                          })
                        }
                      ]
                    }
                  }
                }
              }
            ],
            model: {
              pricing: {
                precise_uncached_input_resource_points_per_unit: 1000000,
                precise_output_resource_points_per_unit: 1000000
              }
            },
            usageSteps: [
              {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3
              }
            ]
          } as any
        }
      />
    )

    expect(html).toContain('4.50')
  })
})
