import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ossUploadService } from '@main/services/OssUploadService'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

export const CLONE_VOICE_TOOL: Tool = {
  name: 'clone_voice',
  description:
    'Clone a voice from reference audio you own or have explicit permission to use. Supports minimax (default), fish and elevenlabs. HTTP(S) URLs, file URLs and absolute local audio paths are supported; local files are uploaded without transcoding. ElevenLabs supports multiple samples and requires an eligible membership with a free clone slot. The backend handles billing and saves the voice to the current account. Use the returned voice_id and request.provider with generate_speech. This creates a new voice and is not idempotent; do not automatically retry a failed or interrupted request.',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      provider: { type: 'string', enum: ['minimax', 'fish', 'elevenlabs'], description: 'Clone provider. Defaults to minimax.' },
      file_url: { type: 'string', description: 'Reference audio HTTP(S) URL, file URL or absolute local path. Required for minimax and fish.' },
      file_urls: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Additional reference audio URLs or absolute local paths. Only supported by elevenlabs. Provide file_url or file_urls.'
      },
      title: { type: 'string', description: 'Optional display name for the cloned voice.' },
      description: { type: 'string', description: 'Optional voice description. Only supported by elevenlabs.' },
      labels: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional voice labels, such as accent or gender. Only supported by elevenlabs.'
      },
      remove_background_noise: { type: 'boolean', description: 'Remove background noise from reference samples. Only supported by elevenlabs; defaults to false.' }
    },
    additionalProperties: false,
    anyOf: [{ required: ['file_url'] }, { required: ['file_urls'] }]
  }
}

function invalid(message: string): never {
  throw new McpError(ErrorCode.InvalidParams, message)
}

function normalizeAudioSource(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return invalid('Reference audio must be a non-empty URL or absolute local path')
  }
  const source = value.trim()
  if (/^https?:\/\//i.test(source)) {
    try {
      return new URL(source).toString()
    } catch {
      return invalid('Invalid reference audio URL')
    }
  }
  if (/^file:/i.test(source)) {
    try {
      return fileURLToPath(source)
    } catch {
      return invalid('Invalid reference audio file URL')
    }
  }
  if (!path.isAbsolute(source)) {
    return invalid('Reference audio must use HTTP(S), a file URL or an absolute local path')
  }
  return source
}

export async function prepareCloneVoiceRequest(args: Record<string, unknown>) {
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && !Object.prototype.hasOwnProperty.call(CLONE_VOICE_TOOL.inputSchema.properties, key)) {
      invalid(`Unknown parameter: ${key}`)
    }
  }
  const provider = args.provider === undefined ? 'minimax' : args.provider
  if (typeof provider !== 'string' || !['minimax', 'fish', 'elevenlabs'].includes(provider)) {
    invalid('provider must be minimax, fish or elevenlabs')
  }
  const payload: Record<string, unknown> = {}
  for (const key of ['title', 'description']) {
    if (args[key] === undefined) continue
    if (typeof args[key] !== 'string') invalid(`${key} must be a string`)
    payload[key] = (args[key] as string).trim()
  }
  const elevenlabsFields = ['file_urls', 'description', 'labels', 'remove_background_noise']
  if (provider !== 'elevenlabs' && elevenlabsFields.some((key) => args[key] !== undefined)) {
    invalid('file_urls, description, labels and remove_background_noise are only supported by elevenlabs')
  }
  if (args.labels !== undefined) {
    if (!args.labels || typeof args.labels !== 'object' || Array.isArray(args.labels) ||
      Object.values(args.labels).some((value) => typeof value !== 'string')) {
      invalid('labels must be an object with string values')
    }
    payload.labels = args.labels
  }
  if (args.remove_background_noise !== undefined) {
    if (typeof args.remove_background_noise !== 'boolean') invalid('remove_background_noise must be a boolean')
    payload.remove_background_noise = args.remove_background_noise
  }
  if (args.file_urls !== undefined && (!Array.isArray(args.file_urls) || args.file_urls.length === 0)) {
    invalid('file_urls must be a non-empty array')
  }
  const sources = Array.isArray(args.file_urls) ? args.file_urls.map(normalizeAudioSource) : []
  if (args.file_url !== undefined) sources.push(normalizeAudioSource(args.file_url))
  if (!sources.length) invalid('file_url or file_urls is required')

  // Validate every sample before uploading; duplicate local files are uploaded only once.
  const uploadedSources: string[] = []
  for (const source of new Set(sources)) {
    if (/^https?:\/\//i.test(source)) {
      uploadedSources.push(source)
    } else {
      const uploaded = await ossUploadService.uploadLocalFile(source, {
        bucket: 'oss-hangzhou-mp4',
        region: 'oss-cn-hangzhou',
        folder: 'agent_tmp/{uid}',
        objectKeyPrefix: 'vectcut_voice_clone_',
        signExpiresSeconds: 60 * 60
      })
      uploadedSources.push(uploaded.signedPublicUrl)
    }
  }
  if (provider === 'elevenlabs') {
    payload.file_urls = uploadedSources
  } else {
    payload.file_url = uploadedSources[0]
  }
  return { provider, endpoint: `/llm/tts/${provider}/clone_voice`, payload }
}
