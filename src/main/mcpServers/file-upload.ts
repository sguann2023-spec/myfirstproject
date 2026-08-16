import path from 'node:path'

import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

import { ossUploadService } from '@main/services/OssUploadService'

const logger = loggerService.withContext('MCPServer:FileUpload')
const MAX_UPLOAD_FILE_SIZE_MB = 500
const FILE_UPLOAD_BUCKET = 'oss-hangzhou-mp4'
const FILE_UPLOAD_REGION = 'oss-cn-hangzhou'
const FILE_UPLOAD_FOLDER_TEMPLATE = 'agent_tmp/{uid}'
const FILE_UPLOAD_OBJECT_KEY_PREFIX = 'vectcut_koubo_tmp_file_'
const FILE_UPLOAD_SIGN_EXPIRES_SECONDS = 60 * 60

const parseBase64DataUrl = (value: string): { mediaType: string; data: string } | null => {
  const normalized = String(value || '').trim()
  const match = normalized.match(/^data:([^;,]+)?;base64,(.+)$/i)
  if (!match) return null
  return {
    mediaType: String(match[1] || 'image/png').trim() || 'image/png',
    data: String(match[2] || '').trim()
  }
}

const UPLOAD_FILE_TO_OSS_TOOL: Tool = {
  name: 'upload_file_to_oss',
  description:
    'Upload content to VectCut temporary OSS storage. Supports a local absolute file path, base64 image data, or a data URL. For attached chat images, provide attachmentIndex when the runtime supports resolving the current attachment.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Optional absolute local file path to upload.'
      },
      base64Data: {
        type: 'string',
        description: 'Optional raw base64 image data to upload.'
      },
      dataUrl: {
        type: 'string',
        description: 'Optional data URL (for example data:image/png;base64,...) to upload.'
      },
      attachmentIndex: {
        type: 'number',
        description: 'Optional 1-based attached image index. Some runtimes resolve this into base64 automatically before calling the tool.'
      },
      contentType: {
        type: 'string',
        description: 'Optional MIME type override. For base64/dataUrl uploads, defaults to the parsed media type or image/png.'
      }
    },
    additionalProperties: false
  }
}

class FileUploadServer {
  public mcpServer: McpServer

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'file-upload',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [UPLOAD_FILE_TO_OSS_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'upload_file_to_oss':
            return await this.uploadFileToOss(args as Record<string, unknown>)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error)
        const message =
          rawMessage === 'FILE_TOO_LARGE' || rawMessage === 'IMAGE_TOO_LARGE'
            ? `文件大小不能超过 ${MAX_UPLOAD_FILE_SIZE_MB}MB， 如有需要请去官网资产库上传：https://www.vectcut.com/materials`
            : rawMessage
        logger.error(`Tool error: ${toolName}`, { error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private async uploadFileToOss(args: Record<string, unknown>) {
    const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : ''
    const rawBase64Data = typeof args.base64Data === 'string' ? args.base64Data.trim() : ''
    const dataUrl = typeof args.dataUrl === 'string' ? args.dataUrl.trim() : ''
    const contentType = typeof args.contentType === 'string' ? args.contentType.trim() : undefined
    const parsedDataUrl = dataUrl ? parseBase64DataUrl(dataUrl) : null
    const base64Data = parsedDataUrl?.data || rawBase64Data
    const resolvedContentType = contentType || parsedDataUrl?.mediaType || 'image/png'

    if (filePath) {
      if (!path.isAbsolute(filePath)) {
        throw new McpError(ErrorCode.InvalidParams, "'filePath' must be an absolute path")
      }

      const uploaded = await ossUploadService.uploadLocalFile(filePath, {
        bucket: FILE_UPLOAD_BUCKET,
        region: FILE_UPLOAD_REGION,
        folder: FILE_UPLOAD_FOLDER_TEMPLATE,
        contentType,
        objectKeyPrefix: FILE_UPLOAD_OBJECT_KEY_PREFIX,
        signExpiresSeconds: FILE_UPLOAD_SIGN_EXPIRES_SECONDS
      })

      const payload = {
        public_url: uploaded.signedPublicUrl
      }

      return {
        structuredContent: payload,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload, null, 2)
          }
        ]
      }
    }

    if (!base64Data) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'filePath', 'base64Data', or 'dataUrl' is required for upload_file_to_oss"
      )
    }

    const uploaded = await ossUploadService.uploadImageBase64(base64Data, resolvedContentType)

    const payload = {
      public_url: uploaded.publicUrl,
      object_key: uploaded.objectKey
    }

    return {
      structuredContent: payload,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2)
        }
      ]
    }
  }
}

export default FileUploadServer
