import { AudioGenerationToolBody } from './AudioGenerationTool'
import { DigitalHumanGenerationToolBody } from './DigitalHumanGenerationTool'
import { ImageGenerationToolBody } from './ImageGenerationTool'
import { getMediaGenerationVariant, isMediaGenerationToolName, type MediaGenerationToolProps } from './mediaGenerationShared'
import { VideoGenerationToolBody } from './VideoGenerationTool'

export { isMediaGenerationToolName }

export function MediaGenerationToolBody(props: MediaGenerationToolProps) {
  const variant = getMediaGenerationVariant(props.toolName)

  if (variant === 'audio') {
    return <AudioGenerationToolBody {...props} />
  }

  if (variant === 'image') {
    return <ImageGenerationToolBody {...props} />
  }

  if (variant === 'digitalHuman') {
    return <DigitalHumanGenerationToolBody {...props} />
  }

  return <VideoGenerationToolBody {...props} />
}
