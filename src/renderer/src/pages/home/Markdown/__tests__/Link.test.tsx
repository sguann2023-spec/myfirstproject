import { fireEvent, render, screen } from '../../../../../../components/Chat/MessagePane/markdown-links.test-utils'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Link from '../Link'
import ReactMarkdown from 'react-markdown'
import { ChatTaskContext } from '../../../../../../components/Chat/ChatShell/ChatTaskContext'
import { markdownUrlTransform } from '../../../../../../shared/markdownFileLinks'

const mocks = vi.hoisted(() => ({
  parseJSON: vi.fn(),
  findCitationInChildren: vi.fn(),
  CitationTooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="citation-tooltip">{children}</div>
  ),
  CitationSchema: {
    safeParse: vi.fn((input: any) => ({ success: !!input, data: input }))
  },
  Hyperlink: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <span data-testid="hyperlink" data-href={href}>
      {children}
    </span>
  )
}))

vi.mock('@renderer/utils/json', () => ({
  parseJSON: mocks.parseJSON
}))

vi.mock('@renderer/utils/markdown', () => ({
  findCitationInChildren: mocks.findCitationInChildren
}))

vi.mock('../CitationTooltip', () => ({
  default: mocks.CitationTooltip,
  CitationSchema: mocks.CitationSchema
}))

vi.mock('../Hyperlink', () => ({
  default: mocks.Hyperlink
}))

describe('Link', () => {
  it.each(['file:///tmp/中文%20a%23b%3Fc.png', './视频.mp4', '/tmp/a.pdf', 'sandbox:/mnt/data/a.pdf'])('routes sanitized local link %s to context, never window.open', (href) => {
    const openFilePath = vi.fn()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<ChatTaskContext.Provider value={{ openFilePath } as any}>
      <ReactMarkdown urlTransform={markdownUrlTransform} components={{ a: Link }}>{`[file](${href})`}</ReactMarkdown>
    </ChatTaskContext.Provider>)
    fireEvent.click(screen.getByText('file'))
    expect(decodeURIComponent(openFilePath.mock.calls[0][0])).toBe(decodeURIComponent(href))
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('retains HTTP preview behavior', () => {
    const openWebUrl = vi.fn()
    render(<ChatTaskContext.Provider value={{ openWebUrl } as any}><Link href="https://example.com">web</Link></ChatTaskContext.Provider>)
    fireEvent.click(screen.getByText('web'))
    expect(openWebUrl).toHaveBeenCalledWith('https://example.com', '')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  it('should match snapshot', () => {
    const { container } = render(<Link href="https://example.com">Example</Link>)
    expect(container).toMatchSnapshot()
  })

  it('should render internal anchor as span.link and no <a>', () => {
    const { container } = render(<Link href="#section-1">Go to section</Link>)
    expect(container.querySelector('span.link')).not.toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('Go to section')).not.toBeNull()
  })

  it('should wrap with CitationTooltip when children include <sup> and citation data exists', () => {
    mocks.findCitationInChildren.mockReturnValue('{"title":"ref"}')
    mocks.parseJSON.mockReturnValue({ title: 'ref' })

    const onParentClick = vi.fn()
    const { container } = render(
      <div onClick={onParentClick}>
        <Link href="https://example.com">
          <span>ref</span>
          <sup>1</sup>
        </Link>
      </div>
    )

    expect(screen.getByTestId('citation-tooltip')).not.toBeNull()

    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor).not.toBeNull()
    expect(anchor.getAttribute('target')).toBeNull()
    expect(anchor.getAttribute('rel')).toBe('noreferrer')

    fireEvent.click(anchor)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('should fall back to Hyperlink when <sup> exists but citation data is null', () => {
    mocks.findCitationInChildren.mockReturnValue('{"title":"ref"}')
    mocks.parseJSON.mockReturnValue(null)

    render(
      <Link href="https://example.com">
        <span>text</span>
        <sup>1</sup>
      </Link>
    )

    expect(screen.getByTestId('hyperlink')).not.toBeNull()
    expect(screen.queryByTestId('citation-tooltip')).toBeNull()
  })

  it('should render normal external link inside Hyperlink when not a citation', () => {
    mocks.findCitationInChildren.mockReturnValue(undefined)
    mocks.parseJSON.mockReturnValue(undefined)

    const { container } = render(<Link href="https://domain.com/path">Open</Link>)

    const wrapper = screen.getByTestId('hyperlink')
    expect(wrapper).not.toBeNull()
    expect(wrapper.getAttribute('data-href')).toBe('https://domain.com/path')

    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor.getAttribute('href')).toBe('https://domain.com/path')
    expect(anchor.getAttribute('target')).toBeNull()
    expect(anchor.getAttribute('rel')).toBe('noreferrer')
  })

  it('should omit empty href for citation link (no href attribute when href="")', () => {
    mocks.findCitationInChildren.mockReturnValue('{"title":"ref"}')
    mocks.parseJSON.mockReturnValue({ title: 'ref' })

    const { container } = render(
      <Link href="">
        text<sup>2</sup>
      </Link>
    )

    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor).not.toBeNull()
    expect(anchor.hasAttribute('href')).toBe(false)
  })
})
