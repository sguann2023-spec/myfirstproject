import { describe, expect, it } from 'vitest'
import { ImageInspectionState } from '../harness/image-inspection-state'

const generate = 'mcp__vectcut__image__generate_or_edit_image'
const inspect = 'mcp__vectcut__image-understand__inspect_image'
const download = 'mcp__vectcut__filesystem-server__download'
const url = 'https://example.com/generated.png'
const result = (status = 'success') => ({
  content: [{ type: 'text', text: JSON.stringify({ status, output: { image_url: url } }) }]
})
const timeout = () => Object.assign(new Error('MCP error -32001: Request timed out'), { code: -32001 })

describe('image inspection failures', () => {
  it('distinguishes confirmed generation from the subsequent inspection timeout', () => {
    const state = new ImageInspectionState('/tmp/workspace')
    state.recordSuccess(generate, {}, result())
    const error = state.inspectionError(inspect, { image: url }, timeout()) as Error
    expect(error.message).toContain('图片已生成，检查超时')
    expect(error.message).toContain('不要因此重新提交生图任务')
    expect(error.cause).toMatchObject({ code: -32001 })
  })

  it('recognizes a downloaded image inspected through a local path or file URL', () => {
    const state = new ImageInspectionState('/tmp/workspace')
    state.recordSuccess(generate, {}, result())
    state.recordSuccess(download, { url, file_path: 'images/result.png' }, {})
    for (const source of ['images/result.png', '/tmp/workspace/images/result.png', 'file:///tmp/workspace/images/result.png']) {
      expect((state.inspectionError(inspect, { file_path: source }, timeout()) as Error).message)
        .toContain('图片已生成，检查超时')
    }
  })

  it('does not claim an uploaded image or pending generation was generated successfully', () => {
    const state = new ImageInspectionState('/tmp/workspace')
    state.recordSuccess(generate, {}, result('processing'))
    const error = state.inspectionError(inspect, { image_url: url }, timeout()) as Error
    expect(error.message).toContain('图片检查超时')
    expect(error.message).not.toContain('图片已生成')
  })

  it('reports non-timeout inspection failures without discarding confirmed generation', () => {
    const state = new ImageInspectionState('/tmp/workspace')
    state.recordSuccess(generate, {}, { structuredContent: { status: 'success', result: { image: url } } })
    expect((state.inspectionError(inspect, { url }, new Error('HTTP 502')) as Error).message)
      .toContain('图片已生成，检查失败')
  })

  it('preserves cancellation and unrelated tool failures', () => {
    const state = new ImageInspectionState('/tmp/workspace')
    const aborted = new DOMException('Request aborted', 'AbortError')
    const error = timeout()
    expect(state.inspectionError(inspect, { image: url }, aborted)).toBe(aborted)
    expect(state.inspectionError(generate, {}, error)).toBe(error)
  })
})
