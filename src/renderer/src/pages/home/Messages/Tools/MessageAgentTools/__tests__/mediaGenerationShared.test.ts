import { describe, expect, it } from 'vitest'

import { getImageUrl, getPrompt, parseOutput } from '../mediaGenerationShared'

describe('mediaGenerationShared.getPrompt', () => {
  it('prefers prompt from input content text items', () => {
    expect(
      getPrompt(
        {
          content: [
            { type: 'audio_url', audio_url: { url: 'file:///tmp/demo.mp3' } },
            { type: 'text', text: '模仿音色生成自我介绍视频' }
          ]
        },
        null
      )
    ).toBe('模仿音色生成自我介绍视频')
  })

  it('falls back to request content text items when flat prompt is missing', () => {
    expect(
      getPrompt(null, {
        request: {
          content: [
            { type: 'image_url', image_url: { url: 'file:///tmp/frame.png' } },
            { type: 'text', text: '让画面动起来' }
          ]
        }
      })
    ).toBe('让画面动起来')
  })
})

describe('mediaGenerationShared.parseOutput', () => {
  it('unwraps media generation wrapper and finds nested output image url', () => {
    const parsed = parseOutput({
      response: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              output: {
                image_url: 'https://example.com/generated.png'
              }
            })
          }
        ]
      },
      responseRaw: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              output: {
                image_url: 'https://example.com/generated.png'
              }
            })
          }
        ]
      }
    })

    expect(getImageUrl(parsed)).toBe('https://example.com/generated.png')
  })

  it('unwraps nested result payload returned by image generation', () => {
    const parsed = parseOutput({
      responseRaw: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: '',
              status: 'success',
              result: {
                billing: {
                  consume: 3
                },
                image: 'https://example.com/result.jpg'
              },
              success: true
            })
          }
        ]
      }
    })

    expect(parsed).toEqual({
      error: '',
      status: 'success',
      result: {
        billing: {
          consume: 3
        },
        image: 'https://example.com/result.jpg'
      },
      success: true
    })
    expect(getImageUrl(parsed)).toBe('https://example.com/result.jpg')
  })
})
