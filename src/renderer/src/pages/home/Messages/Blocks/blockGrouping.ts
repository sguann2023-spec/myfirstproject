import type { TFunction } from 'i18next'
import { loggerService } from '@logger'
import { MessageBlockType, type MessageBlock } from '@renderer/types/newMessage'
import { isVideoBlock } from '@renderer/utils/messageUtils/is'
import { groupConsecutiveTools } from './toolGrouping'

const logger = loggerService.withContext('MessageBlockRenderer')

export type GroupedBlock = MessageBlock[] | MessageBlock

export const groupSimilarBlocks = (blocks: MessageBlock[], t?: TFunction): GroupedBlock[] => {
  return groupConsecutiveTools(blocks, t).reduce((acc: GroupedBlock[], currentBlock) => {
    if (Array.isArray(currentBlock)) {
      acc.push(currentBlock)
    } else if (currentBlock.type === MessageBlockType.THINKING && currentBlock.content?.trim()) {
      const previous = acc[acc.length - 1]
      if (Array.isArray(previous) && previous[0].type === MessageBlockType.THINKING && previous[0].messageId === currentBlock.messageId) {
        previous.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else if (currentBlock.type === MessageBlockType.IMAGE) {
      // 对于IMAGE类型，按连续分组
      const prevGroup = acc[acc.length - 1]
      if (Array.isArray(prevGroup) && prevGroup[0].type === MessageBlockType.IMAGE) {
        prevGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else if (currentBlock.type === MessageBlockType.VIDEO) {
      // 对于VIDEO类型，按相同filePath分组
      if (!isVideoBlock(currentBlock)) {
        logger.warn('Block type is VIDEO but failed type guard check', currentBlock)
        acc.push(currentBlock)
        return acc
      }
      const videoBlock = currentBlock
      const existingGroup = acc.find(
        (group) =>
          Array.isArray(group) &&
          group[0].type === MessageBlockType.VIDEO &&
          isVideoBlock(group[0]) &&
          group[0].filePath === videoBlock.filePath
      ) as MessageBlock[] | undefined

      if (existingGroup) {
        existingGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else {
      acc.push(currentBlock)
    }
    return acc
  }, [])
}

