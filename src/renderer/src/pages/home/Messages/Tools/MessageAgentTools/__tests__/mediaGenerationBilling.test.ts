import { describe, expect, it } from 'vitest'

import { extractMediaGenerationBillingSummary, getMediaGenerationPointIconUrl } from '../mediaGenerationBilling'

describe('mediaGenerationBilling', () => {
  it('extracts billing.consume from MCP text output', () => {
    expect(
      extractMediaGenerationBillingSummary({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'succeeded',
              billing: {
                consume: 3.6
              }
            })
          }
        ]
      })
    ).toEqual({
      totalConsumedPoints: 3.6,
      displayText: '3.60'
    })
  })

  it('extracts nested points_consumed from stringified response payload', () => {
    expect(
      extractMediaGenerationBillingSummary({
        responseRaw: JSON.stringify({
          output: {
            points_consumed: '1.98'
          }
        })
      })
    ).toEqual({
      totalConsumedPoints: 1.98,
      displayText: '1.98'
    })
  })

  it('returns point icon url', () => {
    expect(getMediaGenerationPointIconUrl()).toContain('image/svg+xml')
  })

  it('prefers responseRaw billing when both response and responseRaw exist', () => {
    expect(
      extractMediaGenerationBillingSummary({
        response: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                billing: {
                  consume: 1.11
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
                billing: {
                  consume: 2.22
                }
              })
            }
          ]
        }
      })
    ).toEqual({
      totalConsumedPoints: 2.22,
      displayText: '2.22'
    })
  })

  it('extracts nested result.billing.consume from wrapped image generation output', () => {
    expect(
      extractMediaGenerationBillingSummary({
        response: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                result: {
                  billing: {
                    consume: 3
                  },
                  image: 'https://example.com/result.jpg'
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
                result: {
                  billing: {
                    consume: 3
                  },
                  image: 'https://example.com/result.jpg'
                }
              })
            }
          ]
        }
      })
    ).toEqual({
      totalConsumedPoints: 3,
      displayText: '3.00'
    })
  })

  it('returns null when billing is missing', () => {
    expect(
      extractMediaGenerationBillingSummary({
        content: [{ type: 'text', text: JSON.stringify({ answer: 'ok' }) }]
      })
    ).toBeNull()
  })
})
