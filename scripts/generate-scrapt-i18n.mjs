import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { applyEdits, modify } from 'jsonc-parser'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(await fs.readFile(path.join(root, 'src/main/mcpServers/scrapt-catalog.json'), 'utf8'))
const platforms = {
  tiktok: ['TikTok', 'TikTok'], douyin: ['抖音', 'Douyin'],
  instagram: ['Instagram', 'Instagram'], xiaohongshu: ['小红书', 'Xiaohongshu'],
  youtube: ['YouTube', 'YouTube'], twitter: ['X', 'X'], bilibili: ['哔哩哔哩', 'Bilibili'],
  weibo: ['微博', 'Weibo'], kuaishou: ['快手', 'Kuaishou'], reddit: ['Reddit', 'Reddit'],
  linkedin: ['LinkedIn', 'LinkedIn'], threads: ['Threads', 'Threads'], zhihu: ['知乎', 'Zhihu'],
  wechat: ['微信', 'WeChat'], telegram: ['Telegram', 'Telegram'],
  others: ['媒体', 'Media'], media: ['媒体', 'Media']
}
const titles = { 'zh-cn': {}, 'en-us': {} }
for (const { platform, tool } of catalog.entries) {
  const description = tool.description.trim()
  // Split the bilingual separator, not slashes inside the English description.
  const separator = description.search(/\s*\/\s*(?=[A-Za-z[])/)
  const separatorText = separator < 0 ? '' : description.slice(separator).match(/^\s*\/\s*/)[0]
  const chinese = separator < 0 ? description : description.slice(0, separator)
  const english = separator < 0
    ? ({ douyin_web_handler_shorten_url: 'Generate short link' }[tool.name] || description)
    : description.slice(separator + separatorText.length)
  titles['zh-cn'][tool.name] = `${platforms[platform]?.[0] || platform}：${chinese}`
  titles['en-us'][tool.name] = `${platforms[platform]?.[1] || platform}: ${english}`
}
// Build-time conversion using macOS ICU; no converter or full catalog ships in the renderer.
titles['zh-tw'] = JSON.parse(execFileSync('osascript', [
  '-l', 'JavaScript', '-e',
  'ObjC.import("Foundation"); function run(args) { return ObjC.unwrap($(args[0]).stringByApplyingTransformReverse($("Hans-Hant"), false)); }',
  JSON.stringify(titles['zh-cn'])
], { encoding: 'utf8', maxBuffer: 1024 * 1024 }))
for (const [locale, tools] of Object.entries(titles)) {
  const file = path.join(root, `src/renderer/src/i18n/locales/${locale}.json`)
  const source = await fs.readFile(file, 'utf8')
  const edits = modify(source, ['message', 'tools', 'mcp', 'tools', 'scrapt'], tools, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  })
  await fs.writeFile(file, applyEdits(source, edits))
}
console.log(`Generated localized titles for ${catalog.entries.length} media tools`)
