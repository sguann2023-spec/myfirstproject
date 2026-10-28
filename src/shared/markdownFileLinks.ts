import { defaultUrlTransform } from 'react-markdown'

const scheme = /^[a-z][a-z\d+.-]*:/i
const drive = /^[a-z]:[\\/]/i

export const isLocalFileLink = (href: string) => Boolean(href) && !href.startsWith('#') &&
  (drive.test(href) || !scheme.test(href) || /^file:|^sandbox:/i.test(href))

// Only anchors may carry local links. All other URLs retain react-markdown's sanitizer.
export function markdownUrlTransform(value: string, key: string) {
  if (key === 'href' && isLocalFileLink(value)) return value
  if (key === 'src' && /^data:image\/(png|jpeg)/.test(value)) return value
  return defaultUrlTransform(value)
}

export function resolveMarkdownFilePath(href: string, workspace = ''): string {
  if (/^sandbox:/i.test(href)) throw new Error('sandbox 链接无法映射到本机文件，请提供工作空间内的文件路径')
  if (!isLocalFileLink(href)) throw new Error('不是有效的本地文件链接')
  let path = href
  if (/^file:/i.test(path)) {
    // Do not let URL discard literal # or ? in model-generated file names.
    const match = /^file:\/\/([^/]*)(\/.*)$/i.exec(path)
    if (!match || (match[1] && match[1].toLowerCase() !== 'localhost')) throw new Error('仅支持本机 file:// 文件链接')
    path = match[2]
  }
  try { path = decodeURIComponent(path) } catch { throw new Error('文件路径编码无效') }
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new Error('文件路径包含无效字符')
  path = path.replace(/\\/g, '/')
  if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
  if (path.startsWith('//')) throw new Error('不支持网络文件路径')
  if (!path.startsWith('/') && !drive.test(path)) {
    if (!workspace || (!workspace.startsWith('/') && !drive.test(workspace))) throw new Error('当前对话未绑定工作空间，无法解析相对文件路径')
    path = `${workspace.replace(/\\/g, '/').replace(/\/$/, '')}/${path}`
  }
  const prefix = drive.test(path) ? path.slice(0, 3) : '/'
  const parts: string[] = []
  for (const part of path.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return prefix + parts.join('/')
}

export function openMarkdownFileLink(href: string, openFilePath?: ((path: string) => unknown) | null) {
  if (!isLocalFileLink(href)) return false
  if (openFilePath) void openFilePath(href)
  else (window as any).toast?.warning('当前页面不支持本地文件预览')
  return true
}
