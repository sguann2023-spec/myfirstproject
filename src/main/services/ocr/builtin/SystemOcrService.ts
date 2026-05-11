import { isLinux, isWin } from '@main/constant'
import { loadOcrImage } from '@main/utils/ocr'
import type { ImageFileMetadata, OcrResult, OcrSystemConfig, SupportedOcrFile } from '@types'
import { isImageFileMetadata } from '@types'

import { OcrBaseService } from './OcrBaseService'

// const logger = loggerService.withContext('SystemOcrService')
type SystemOcrModule = typeof import('@napi-rs/system-ocr')
let systemOcrModulePromise: Promise<SystemOcrModule> | null = null

const loadSystemOcrModule = async (): Promise<SystemOcrModule> => {
  if (!systemOcrModulePromise) {
    systemOcrModulePromise = import('@napi-rs/system-ocr')
  }
  return systemOcrModulePromise
}

export class SystemOcrService extends OcrBaseService {
  constructor() {
    super()
  }

  private async ocrImage(file: ImageFileMetadata, options?: OcrSystemConfig): Promise<OcrResult> {
    if (isLinux) {
      return { text: '' }
    }
    const buffer = await loadOcrImage(file)
    const langs = isWin ? options?.langs : undefined
    let ocrModule: SystemOcrModule
    try {
      ocrModule = await loadSystemOcrModule()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`System OCR native binding is unavailable: ${detail}`)
    }
    const result = await ocrModule.recognize(buffer, ocrModule.OcrAccuracy.Accurate, langs)
    return { text: result.text }
  }

  public ocr = async (file: SupportedOcrFile, options?: OcrSystemConfig): Promise<OcrResult> => {
    if (isImageFileMetadata(file)) {
      return this.ocrImage(file, options)
    } else {
      throw new Error('Unsupported file type, currently only image files are supported')
    }
  }
}

export const systemOcrService = new SystemOcrService()
