import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const TEMPLATE_PATH = '/Users/sunguannan/CapCutHelper/template.text'
const STORE_PATH = path.join(os.homedir(), 'Library/Application Support/@sun-guannan/vectcut/vectcut.json')
const API_HOST = 'https://open.vectcut.com'
const TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const CLIENT_ID = '6901dd145dafc6f1f3143938'
const CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const DIRECT_API_KEY = String(process.env.VECTCUT_API_KEY || '').trim()
const OUTPUT_ROOT = '/Users/sunguannan/CapCutHelper/out/image_template_samples'
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.BATCH_CONCURRENCY || '4', 10) || 4)
const POLL_INTERVAL_MS = 8000
const POLL_TIMEOUT_MS = 12 * 60 * 1000
const REQUEST_RETRY_COUNT = 3
const ONLY_INDICES = String(process.env.ONLY_INDICES || '')
  .split(',')
  .map((item) => Number.parseInt(item.trim(), 10))
  .filter((item) => Number.isInteger(item) && item > 0)

const EXPLICIT_MODEL_PATTERNS = [
  [/gpt\s*image\s*2/i, 'gpt-image-2-all'],
  [/nano\s*banana\s*pro/i, 'nano_banana_pro'],
  [/nano\s*banana/i, 'nano_banana_2'],
  [/seedr?eem\s*5\.0/i, 'seedream-5.0'],
  [/seedr?eem\s*4\.5/i, 'seedream-4.5'],
  [/seedr?eem\s*4\.0/i, 'seedream-4.0'],
  [/seedr?eem\s*3\.0/i, 'seedream-3.0']
]

const MODEL_PRIORITY = ['seedream-4.5', 'seedream-4.0', 'seedream-5.0', 'seedream-3.0', 'nano_banana_2', 'nano_banana_pro', 'gpt-image-2-all']
const PREFERRED_TIERS = ['1K', '2K', '3K', '4K']

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sanitizeFileStem(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80)
}

function summarizePrompt(prompt) {
  const compact = String(prompt || '').replace(/\s+/g, ' ').trim()
  return compact.length > 40 ? `${compact.slice(0, 40)}...` : compact
}

function normalizePromptContent(content) {
  return content.replace(/^\s*(gpt\s*image\s*2|nano\s*banana(?:\s*pro)?|seedr?eem\s*[345]\.0)\s*模型\s*[：:]\s*/i, '').trim()
}

function parseEntries(rawText) {
  const source = String(rawText || '')
  const entries = []
  let expectedIndex = 1
  let cursor = 0

  while (expectedIndex <= 200) {
    const marker = `${expectedIndex}.`
    const start = source.indexOf(marker, cursor)
    if (start === -1) {
      break
    }
    const nextMarker = `${expectedIndex + 1}.`
    const nextStart = source.indexOf(`\n${nextMarker}`, start + marker.length)
    const block = source.slice(start, nextStart === -1 ? source.length : nextStart).trim()
    const content = block.slice(marker.length).trim()
    const ratio = (content.match(/比例\s*([0-9]+:[0-9]+)/) || [null, '1:1'])[1]
    const explicitModel = EXPLICIT_MODEL_PATTERNS.find(([pattern]) => pattern.test(content))?.[1] || null
    entries.push({
      index: expectedIndex,
      ratio,
      explicitModel,
      original: content,
      prompt: normalizePromptContent(content)
    })
    cursor = nextStart === -1 ? source.length : nextStart + 1
    expectedIndex += 1
  }

  return entries
}

async function readRefreshToken() {
  const raw = await fs.readFile(STORE_PATH, 'utf8')
  const store = JSON.parse(raw)
  const refreshToken = String(store?.auth?.refresh_token || '').trim()
  if (!refreshToken) {
    throw new Error('未找到 refresh_token')
  }
  return refreshToken
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET
  })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  if (!response.ok) {
    throw new Error(`刷新 access token 失败: ${response.status}`)
  }
  const payload = await response.json()
  const accessToken = String(payload?.access_token || '').trim()
  if (!accessToken) {
    throw new Error('刷新 access token 后未拿到 access_token')
  }
  return accessToken
}

async function requestJson(accessToken, endpoint, options = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(`${API_HOST}${endpoint}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
      })
      const text = await response.text()
      let payload = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = text
      }
      if (!response.ok) {
        throw new Error(`请求失败 ${endpoint} (${response.status}): ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`)
      }
      return payload
    } catch (error) {
      lastError = error
      if (attempt < REQUEST_RETRY_COUNT) {
        await sleep(1200 * attempt)
        continue
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function buildResolutionIndex(capabilitiesPayload) {
  const capabilities = capabilitiesPayload?.capabilities || {}
  const prices = capabilitiesPayload?.prices || {}
  return {
    capabilities,
    prices,
    availableModels: Object.keys(capabilities)
  }
}

function chooseFallbackModels(availableModels) {
  const prioritized = MODEL_PRIORITY.filter((item) => availableModels.includes(item))
  const rest = availableModels.filter((item) => !prioritized.includes(item))
  return [...prioritized, ...rest]
}

function chooseModel(entry, fallbackModels, fallbackCursorRef) {
  if (entry.explicitModel) {
    return entry.explicitModel
  }
  const model = fallbackModels[fallbackCursorRef.value % fallbackModels.length]
  fallbackCursorRef.value += 1
  return model
}

function pickSizeForModel(capabilities, model, ratio) {
  const modelCaps = capabilities?.[model]
  const resolutions = modelCaps?.resolutions || {}
  for (const tier of PREFERRED_TIERS) {
    const items = Array.isArray(resolutions[tier]) ? resolutions[tier] : []
    const matched = items.find((item) => item?.ratio === ratio && item?.size)
    if (matched) {
      return { tier, size: matched.size }
    }
  }
  for (const tier of Object.keys(resolutions)) {
    const items = Array.isArray(resolutions[tier]) ? resolutions[tier] : []
    const matched = items.find((item) => item?.ratio === ratio && item?.size)
    if (matched) {
      return { tier, size: matched.size }
    }
  }
  for (const tier of PREFERRED_TIERS) {
    const items = Array.isArray(resolutions[tier]) ? resolutions[tier] : []
    if (items[0]?.size) {
      return { tier, size: items[0].size, ratio: items[0].ratio || ratio }
    }
  }
  for (const tier of Object.keys(resolutions)) {
    const items = Array.isArray(resolutions[tier]) ? resolutions[tier] : []
    if (items[0]?.size) {
      return { tier, size: items[0].size, ratio: items[0].ratio || ratio }
    }
  }
  throw new Error(`模型 ${model} 没有可用分辨率`)
}

async function submitImageTask(accessToken, payload) {
  return requestJson(accessToken, '/llm/image/submit_task/generate', {
    method: 'POST',
    body: {
      ...payload,
      compose_draft: false
    }
  })
}

async function pollTaskUntilDone(accessToken, taskId) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const statusPayload = await requestJson(accessToken, `/llm/image/submit_task/task_status?task_id=${encodeURIComponent(taskId)}`)
    const status = String(statusPayload?.status || '').toLowerCase()
    if (['success', 'failed', 'error'].includes(status)) {
      return statusPayload
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`任务超时: ${taskId}`)
}

async function downloadImage(url, outputPath) {
  let lastError = null
  for (let attempt = 1; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`下载图片失败: ${response.status}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      await fs.writeFile(outputPath, buffer)
      return
    } catch (error) {
      lastError = error
      if (attempt < REQUEST_RETRY_COUNT) {
        await sleep(1500 * attempt)
        continue
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function inferExtension(url) {
  const pathname = new URL(url).pathname.toLowerCase()
  if (pathname.endsWith('.png')) return '.png'
  if (pathname.endsWith('.webp')) return '.webp'
  return '.jpg'
}

async function ensureOutputDir() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const outputDir = path.join(OUTPUT_ROOT, timestamp)
  await fs.mkdir(outputDir, { recursive: true })
  return outputDir
}

function buildReport(entries, outputDir, capabilities, prices) {
  const lines = [
    '# 图片模板样例批量结果',
    '',
    `- 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `- 输出目录：\`${outputDir}\``,
    '',
    '| 序号 | 模型 | 比例 | 尺寸 | 价格 | 状态 | 文件 | 远程链接 | 提示词摘要 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ]

  for (const entry of entries) {
    const modelCaps = capabilities[entry.model] || {}
    const displayName = modelCaps.display_name || entry.model
    const priceValue = prices?.[entry.model]?.resource_points_per_unit
    const priceText = typeof priceValue === 'number' ? `${Number.isInteger(priceValue) ? priceValue : priceValue.toFixed(1)}/张` : '-'
    const fileText = entry.localPath ? path.basename(entry.localPath) : '-'
    const remoteText = entry.imageUrl ? `<${entry.imageUrl}>` : '-'
    lines.push(
      `| ${entry.index} | ${displayName} | ${entry.ratio} | ${entry.size || '-'} | ${priceText} | ${entry.status} | ${fileText} | ${remoteText} | ${summarizePrompt(entry.prompt)} |`
    )
  }

  lines.push('', '## 详细提示词', '')
  for (const entry of entries) {
    const modelCaps = capabilities[entry.model] || {}
    const displayName = modelCaps.display_name || entry.model
    lines.push(`### ${entry.index}. ${displayName}`)
    lines.push('')
    lines.push(`- 比例：${entry.ratio}`)
    lines.push(`- 尺寸：${entry.size || '-'}`)
    lines.push(`- 状态：${entry.status}`)
    if (entry.localPath) {
      lines.push(`- 本地文件：\`${entry.localPath}\``)
    }
    if (entry.imageUrl) {
      lines.push(`- 远程链接：<${entry.imageUrl}>`)
    }
    lines.push(`- 提示词：${entry.prompt}`)
    lines.push('')
  }

  return lines.join('\n')
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length)
  let cursor = 0
  async function runWorker() {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) {
        return
      }
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runWorker()))
  return results
}

async function main() {
  const rawText = await fs.readFile(TEMPLATE_PATH, 'utf8')
  const parsedEntries = parseEntries(rawText)
    .filter((entry) => ONLY_INDICES.length === 0 || ONLY_INDICES.includes(entry.index))
  if (parsedEntries.length === 0) {
    throw new Error('template.text 里没有解析出模板')
  }

  const accessToken = DIRECT_API_KEY || await (async () => {
    const refreshToken = await readRefreshToken()
    return refreshAccessToken(refreshToken)
  })()
  const capabilitiesPayload = await requestJson(accessToken, '/llm/image/model_capabilities')
  const { capabilities, prices, availableModels } = buildResolutionIndex(capabilitiesPayload)
  const fallbackModels = chooseFallbackModels(availableModels)
  const fallbackCursorRef = { value: 0 }
  const outputDir = await ensureOutputDir()

  const taskPlan = parsedEntries.map((entry) => {
    const model = chooseModel(entry, fallbackModels, fallbackCursorRef)
    const picked = pickSizeForModel(capabilities, model, entry.ratio)
    return {
      ...entry,
      model,
      tier: picked.tier,
      size: picked.size,
      effectiveRatio: picked.ratio || entry.ratio,
      status: 'planned'
    }
  })

  console.log(`Parsed ${taskPlan.length} templates, output dir: ${outputDir}`)

  const taskResults = await runPool(taskPlan, async (entry) => {
    const displayName = capabilities?.[entry.model]?.display_name || entry.model
    console.log(`[${entry.index}] submit ${displayName} ${entry.size}`)
    try {
      const submitPayload = await submitImageTask(accessToken, {
        prompt: entry.prompt,
        model: entry.model,
        size: entry.size
      })
      const taskId = String(submitPayload?.task_id || '')
      if (!taskId) {
        throw new Error(`提交后未返回 task_id: ${JSON.stringify(submitPayload)}`)
      }
      console.log(`[${entry.index}] queued ${taskId}`)
      const statusPayload = await pollTaskUntilDone(accessToken, taskId)
      const status = String(statusPayload?.status || 'unknown')
      const imageUrl = statusPayload?.result?.image || statusPayload?.result?.image_url || ''
      const error = statusPayload?.error || statusPayload?.message || ''
      if (status !== 'success' || !imageUrl) {
        return {
          ...entry,
          taskId,
          status: status || 'failed',
          error: error || '未返回图片链接'
        }
      }
      const ext = inferExtension(imageUrl)
      const fileStem = sanitizeFileStem(`${String(entry.index).padStart(2, '0')}_${slugify(entry.model)}_${entry.ratio}`)
      const localPath = path.join(outputDir, `${fileStem}${ext}`)
      await downloadImage(imageUrl, localPath)
      console.log(`[${entry.index}] done ${path.basename(localPath)}`)
      return {
        ...entry,
        taskId,
        status: 'success',
        imageUrl,
        localPath
      }
    } catch (error) {
      console.log(`[${entry.index}] failed ${error instanceof Error ? error.message : String(error)}`)
      return {
        ...entry,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }, CONCURRENCY)

  const report = buildReport(taskResults, outputDir, capabilities, prices)
  const reportPath = path.join(outputDir, 'report.md')
  const jsonPath = path.join(outputDir, 'results.json')
  await fs.writeFile(reportPath, report)
  await fs.writeFile(jsonPath, JSON.stringify(taskResults, null, 2))

  console.log(`REPORT_PATH=${reportPath}`)
  console.log(`RESULTS_PATH=${jsonPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
