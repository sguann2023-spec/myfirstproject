import { describe, expect, it } from 'vitest'

import { extractMediaGenerationBillingSummary, getMediaGenerationPointIconUrl, sumMediaGenerationBillingSummaries } from '../mediaGenerationBilling'

describe('mediaGenerationBilling', () => {
  it('shows actual settled points and never promotes expected compute cost to consumption', () => {
    const charged = { content: [{ type: 'text', text: JSON.stringify({
      provider: 'vectcut', job_id: 'job_test', billing: {
        status: 'charged', complete: true, total_consumed_points: 71.18, consumption_log_id: 2345708
      }
    }) }] }
    expect(extractMediaGenerationBillingSummary(charged)).toEqual({ totalConsumedPoints: 71.18, displayText: '71.18' })
    expect(extractMediaGenerationBillingSummary({ billing: { status: 'pending', complete: false }, expected_points: 99 })).toBeNull()
    expect(extractMediaGenerationBillingSummary({ billing: { status: 'uncertain', complete: false }, expected_points: 99 })).toBeNull()
  })

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

  it('extracts normalized video-portrait-matte billing (backend consumed_points mapped to billing.total_consumed_points)', () => {
    expect(
      extractMediaGenerationBillingSummary({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              provider: 'vectcut', action: 'submit_and_wait', task: 'submit_video_portrait_matte_task',
              status: 'success', video_url: 'https://example.com/matte.webm',
              billing_status: 'charged', consumed_points: '25.00', project_id: '517',
              billing: { total_consumed_points: 25 }
            })
          }
        ]
      })
    ).toEqual({ totalConsumedPoints: 25, displayText: '25.00' })
  })

  it('does not extract the legacy matte shape (top-level consumed_points without billing)', () => {
    expect(
      extractMediaGenerationBillingSummary({
        content: [{ type: 'text', text: JSON.stringify({ status: 'success', consumed_points: '25.00' }) }]
      })
    ).toBeNull()
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

  it('extracts deduct_points from a completed oral-template task', () => {
    expect(
      extractMediaGenerationBillingSummary({
        status: 'success',
        success: true,
        deduct_points: 40,
        output: {
          draft_id: 'draft-1'
        }
      })
    ).toEqual({
      totalConsumedPoints: 40,
      displayText: '40.00'
    })
  })

  it('extracts Seed Audio billing from nested tool results and sums each call only once', () => {
    const outputs = [1.11, 2.22, 3.33].map(consume => {
      const response = { content: [{ type: 'text', text: JSON.stringify({
        provider: 'vectcut', action: 'generate_seed_audio', success: true,
        resource_amount: 99, billing: { consume }
      }) }], structuredContent: { billing: { consume } } }
      return { response, responseRaw: response }
    })
    outputs.forEach((output, index) => {
      expect(extractMediaGenerationBillingSummary(output)).toEqual({
        totalConsumedPoints: [1.11, 2.22, 3.33][index], displayText: ['1.11', '2.22', '3.33'][index]
      })
    })
    expect(sumMediaGenerationBillingSummaries(outputs)).toEqual({ totalConsumedPoints: 6.66, displayText: '6.66' })
  })

  it('does not invent Seed Audio points from resource amounts or timeout errors', () => {
    for (const response of [
      { content: [{ type: 'text', text: JSON.stringify({ success: true, resource_amount: 99 }) }] },
      { isError: true, content: [{ type: 'text', text: 'MCP error -32001: Request timed out' }] }
    ]) {
      expect(extractMediaGenerationBillingSummary({ response, responseRaw: response })).toBeNull()
    }
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

  it.each(['queued', 'consumed'])('extracts media proxy billing with status %s', (status) => {
    const billing = { total_consumed_points: 2.5, status }
    for (const output of [
      { content: [{ type: 'text', text: JSON.stringify({ billing, code: 200, data: [] }) }] },
      { content: [{ type: 'text', text: 'truncated JSON' }], details: { billing } },
      { content: [{ type: 'text', text: 'raw response' }], structuredContent: { billing } }
    ]) {
      expect(extractMediaGenerationBillingSummary(output)).toEqual({
        totalConsumedPoints: 2.5, displayText: '2.50'
      })
    }
  })

  it('sums billed tool results and skips unbilled ones', () => {
    expect(
      sumMediaGenerationBillingSummaries([
        { content: [{ type: 'text', text: JSON.stringify({ billing: { consume: 2 } }) }] },
        { content: [{ type: 'text', text: JSON.stringify({ billing: { consume: 2 } }) }] }
      ])
    ).toEqual({ totalConsumedPoints: 4, displayText: '4.00' })
    expect(
      sumMediaGenerationBillingSummaries([
        { content: [{ type: 'text', text: JSON.stringify({ answer: 'ok' }) }] },
        { content: [{ type: 'text', text: JSON.stringify({ billing: { consume: 1.98 } }) }] }
      ])
    ).toEqual({ totalConsumedPoints: 1.98, displayText: '1.98' })
  })

  it('returns null when no result carries billing', () => {
    expect(sumMediaGenerationBillingSummaries([])).toBeNull()
    expect(
      sumMediaGenerationBillingSummaries([
        { content: [{ type: 'text', text: JSON.stringify({ answer: 'ok' }) }] }
      ])
    ).toBeNull()
  })
  it('shows queued proxy estimates distinctly, including nested structuredContent', () => {
    const billing = { status: 'queued', estimated_points: 2, project_id: 48 }
    for (const output of [
      { billing },
      { content: [{ type: 'text', text: JSON.stringify({ code: 0, billing }) }] },
      { responseRaw: { structuredContent: { billing } } }
    ]) {
      expect(extractMediaGenerationBillingSummary(output)).toEqual({
        totalConsumedPoints: 2, displayText: '≈2.00', estimated: true
      })
    }
    expect(sumMediaGenerationBillingSummaries([
      { billing }, { billing: { total_consumed_points: 3 } }
    ])).toEqual({ totalConsumedPoints: 5, displayText: '≈5.00', estimated: true })
  })

  it('does not turn unknown, failed or absent quotes into consumed points', () => {
    for (const status of ['unknown', 'not_charged', 'failed', undefined]) {
      expect(extractMediaGenerationBillingSummary({ billing: { status, estimated_points: 2 } })).toBeNull()
    }
    expect(extractMediaGenerationBillingSummary({ billing: { status: 'queued', estimated_points: -2 } })).toBeNull()
    expect(extractMediaGenerationBillingSummary({ billing: {
      status: 'queued', total_consumed_points: 1.5, estimated_points: 2
    } })).toEqual({ totalConsumedPoints: 1.5, displayText: '1.50' })
  })

})
