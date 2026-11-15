import { describe, expect, it } from 'vitest'

import { repairBoldRunConcatenation, splitThinkingTags, thinkingPreviewLines } from '../thinkingTags'

describe('splitThinkingTags', () => {
  it('returns plain text untouched when no thinking tag is present', () => {
    expect(splitThinkingTags('普通正文')).toEqual({ main: '普通正文', thinking: '' })
  })

  it('extracts closed thinking segments out of the main text', () => {
    expect(splitThinkingTags('<thinking>推理</thinking>正文')).toEqual({ main: '正文', thinking: '推理' })
  })

  it('treats an unclosed trailing thinking tag as thinking (streaming/aborted rounds)', () => {
    expect(splitThinkingTags('<thinking>**A****B**')).toEqual({ main: '', thinking: '**A****B**' })
  })

  it('joins multiple segments and drops stray closing tags', () => {
    expect(splitThinkingTags('<thinking>一</thinking>中<thinking>二</thinking>后</thinking>')).toEqual({
      main: '中后',
      thinking: '一\n\n二'
    })
  })
})

describe('repairBoldRunConcatenation', () => {
  it('inserts paragraph breaks between adjacent bold runs', () => {
    expect(repairBoldRunConcatenation('**A****B****C**')).toBe('**A**\n\n**B**\n\n**C**')
  })

  it('leaves ordinary markdown emphasis alone', () => {
    const text = '**bold** and *italic* and ***both***\nnext line'
    expect(repairBoldRunConcatenation(text)).toBe(text)
  })
})

describe('thinkingPreviewLines', () => {
  it('repairs concatenation and strips emphasis markers for plain previews', () => {
    expect(thinkingPreviewLines('**Preparing****Building**\n\n')).toEqual(['Preparing', 'Building'])
  })

  it('drops blank and zero-width-only lines', () => {
    expect(thinkingPreviewLines(' \n\u200B\n real \n')).toEqual(['real'])
    expect(thinkingPreviewLines(null)).toEqual([])
  })
})