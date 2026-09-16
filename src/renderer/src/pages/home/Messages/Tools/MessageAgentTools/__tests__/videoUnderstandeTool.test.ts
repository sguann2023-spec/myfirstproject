import { describe, expect, it } from 'vitest'

import {
  extractVideoUnderstandeBillingSummary,
  extractVideoUnderstandeOutputSummary,
  getVideoUnderstandePointIconUrl,
  isVideoUnderstandeToolName,
  VIDEO_UNDERSTANDE_TOOL_NAME
} from '../videoUnderstandeTool'

describe('videoUnderstandeTool', () => {
  it('recognizes the video understand MCP tool name', () => {
    expect(isVideoUnderstandeToolName(VIDEO_UNDERSTANDE_TOOL_NAME)).toBe(true)
    expect(isVideoUnderstandeToolName('mcp__other__tool')).toBe(false)
  })

  it('extracts billing points from video understand output', () => {
    const summary = extractVideoUnderstandeBillingSummary({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            provider: 'vectcut',
            action: 'inspect_video',
            billing: {
              total_consumed_points: 3.6
            }
          })
        }
      ]
    })

    expect(summary).toEqual({
      totalConsumedPoints: 3.6,
      displayText: '3.60'
    })
  })

  it('extracts result file list from video understand output', () => {
    const summary = extractVideoUnderstandeOutputSummary({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            total_video_count: 2,
            default_fps: 3,
            billing: {
              total_consumed_points: 3.6
            },
            videos: [
              {
                duration_seconds: 12.4
              },
              {
                duration_seconds: 7.6
              }
            ],
            result_files: [
              {
                kind: 'result_index',
                file_path: '/tmp/index.md',
                relative_path: '.capcut/tool-results/video-understand/index.md'
              },
              {
                kind: 'video_result',
                video_index: 1,
                original_input: 'a.mp4',
                file_path: '/tmp/video-1.md',
                relative_path: '.capcut/tool-results/video-understand/video-1.md'
              }
            ],
            artifact: {
              file_path: '/tmp/artifact.json',
              relative_path: '.capcut/tool-results/video-understand/artifact.json'
            }
          })
        }
      ]
    })

    expect(summary).toEqual({
      totalVideoCount: 2,
      defaultFps: 3,
      totalDurationSeconds: 20,
      totalConsumedPoints: 3.6,
      resultFiles: [
        {
          kind: 'result_index',
          filePath: '/tmp/index.md',
          relativePath: '.capcut/tool-results/video-understand/index.md'
        },
        {
          kind: 'video_result',
          videoIndex: 1,
          originalInput: 'a.mp4',
          filePath: '/tmp/video-1.md',
          relativePath: '.capcut/tool-results/video-understand/video-1.md'
        }
      ],
      artifactFile: {
        kind: 'artifact',
        filePath: '/tmp/artifact.json',
        relativePath: '.capcut/tool-results/video-understand/artifact.json'
      }
    })
  })

  it('extracts billing and result summary from direct payload objects', () => {
    const output = {
      total_video_count: 2,
      default_fps: 3,
      billing: {
        total_consumed_points: 1.98
      },
      videos: [
        {
          duration_seconds: 10.5
        },
        {
          duration_seconds: 9.5
        }
      ],
      result_files: [
        {
          kind: 'result_index',
          file_path: '/tmp/index.md',
          relative_path: 'video-understand/index.md'
        }
      ]
    }

    expect(extractVideoUnderstandeBillingSummary(output)).toEqual({
      totalConsumedPoints: 1.98,
      displayText: '1.98'
    })

    expect(extractVideoUnderstandeOutputSummary(output)).toEqual({
      totalVideoCount: 2,
      defaultFps: 3,
      totalDurationSeconds: 20,
      totalConsumedPoints: 1.98,
      resultFiles: [
        {
          kind: 'result_index',
          filePath: '/tmp/index.md',
          relativePath: 'video-understand/index.md'
        }
      ],
      artifactFile: null
    })
  })

  it('extracts billing points from nested responseRaw content', () => {
    const summary = extractVideoUnderstandeBillingSummary({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            responseRaw: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    billing: {
                      total_consumed_points: '5.25'
                    }
                  })
                }
              ]
            }
          })
        }
      ]
    })

    expect(summary).toEqual({
      totalConsumedPoints: 5.25,
      displayText: '5.25'
    })
  })

  it('extracts billing and result summary from double-wrapped MCP output', () => {
    const wrappedPayload = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            provider: 'vectcut',
            total_video_count: 10,
            default_fps: 3,
            billing: {
              total_consumed_points: 7.035063999999998
            },
            videos: [
              {
                duration_seconds: 15.5
              }
            ],
            result_files: [
              {
                kind: 'result_index',
                file_path: '/tmp/index.md',
                relative_path: 'video-understand/index.md'
              }
            ]
          })
        }
      ]
    }

    const output = {
      content: [
        {
          type: 'text',
          text: JSON.stringify(wrappedPayload)
        }
      ]
    }

    expect(extractVideoUnderstandeBillingSummary(output)).toEqual({
      totalConsumedPoints: 7.035063999999998,
      displayText: '7.04'
    })

    expect(extractVideoUnderstandeOutputSummary(output)).toEqual({
      totalVideoCount: 10,
      defaultFps: 3,
      totalDurationSeconds: 15.5,
      totalConsumedPoints: 7.035063999999998,
      resultFiles: [
        {
          kind: 'result_index',
          filePath: '/tmp/index.md',
          relativePath: 'video-understand/index.md'
        }
      ],
      artifactFile: null
    })
  })

  it('prefers intact response when responseRaw is truncated', () => {
    const output = {
      response: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              total_video_count: 1,
              default_fps: 3,
              billing: {
                total_consumed_points: 2.04
              },
              videos: [
                {
                  duration_seconds: 32.295
                }
              ],
              result_files: [
                {
                  kind: 'result_index',
                  file_path: '/tmp/index.md',
                  relative_path: 'video-understand/index.md'
                }
              ],
              artifact: {
                file_path: '/tmp/artifact.json',
                relative_path: 'video-understand/artifact.json'
              }
            })
          }
        ]
      },
      responseRaw:
        '{ "content": [{ "type": "text", "text": "{\\"provider\\":\\"vectcut\\",\\"billing\\":{\\"total_consumed_points\\":2.04}'
    }

    expect(extractVideoUnderstandeBillingSummary(output)).toEqual({
      totalConsumedPoints: 2.04,
      displayText: '2.04'
    })

    expect(extractVideoUnderstandeOutputSummary(output)).toEqual({
      totalVideoCount: 1,
      defaultFps: 3,
      totalDurationSeconds: 32.295,
      totalConsumedPoints: 2.04,
      resultFiles: [
        {
          kind: 'result_index',
          filePath: '/tmp/index.md',
          relativePath: 'video-understand/index.md'
        }
      ],
      artifactFile: {
        kind: 'artifact',
        filePath: '/tmp/artifact.json',
        relativePath: 'video-understand/artifact.json'
      }
    })
  })

  it('extracts summary fields from truncated serialized payload text', () => {
    const output =
      '{"content":[{"type":"text","text":"{\\"provider\\":\\"vectcut\\",\\"total_video_count\\":1,\\"default_fps\\":3,\\"billing\\":{\\"total_consumed_points\\":2.22},\\"videos\\":[{\\"duration_seconds\\":32.295}],\\"result_files\\":[{\\"kind\\":\\"result_index\\",\\"file_path\\":\\"/tmp/index.md\\",\\"relative_path\\":\\"video-understand/index.md\\"}],\\"artifact\\":{\\"file_path\\":\\"/tmp/artifact.json\\",\\"relative_path\\":\\"video-understand/artifact.json\\"}'

    expect(extractVideoUnderstandeBillingSummary(output)).toEqual({
      totalConsumedPoints: 2.22,
      displayText: '2.22'
    })

    expect(extractVideoUnderstandeOutputSummary(output)).toEqual({
      totalVideoCount: 1,
      defaultFps: 3,
      totalDurationSeconds: 32.295,
      totalConsumedPoints: 2.22,
      resultFiles: [
        {
          kind: 'result_index',
          filePath: '/tmp/index.md',
          relativePath: 'video-understand/index.md'
        }
      ],
      artifactFile: {
        kind: 'artifact',
        filePath: '/tmp/artifact.json',
        relativePath: 'video-understand/artifact.json'
      }
    })
  })

  it('returns point icon url from public path', () => {
    expect(getVideoUnderstandePointIconUrl()).toContain('image/svg+xml')
  })

  it('returns null when billing is missing', () => {
    expect(
      extractVideoUnderstandeBillingSummary({
        content: [{ type: 'text', text: JSON.stringify({ answer: 'ok' }) }]
      })
    ).toBeNull()
  })
})
