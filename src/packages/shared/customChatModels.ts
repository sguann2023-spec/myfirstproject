export interface CustomChatModel {
  id: string
  name: string
  protocol: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  modelId: string
  read_image: boolean
}

export interface CustomChatProvider {
  id: string
  name: string
  protocol: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  models: { id: string; name: string; modelId: string; read_image: boolean; enabled: boolean }[]
}
