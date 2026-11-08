import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getJson: vi.fn() }))
vi.mock('../../../../../../http', () => ({ http: { getJson: mocks.getJson } }))
import { getChatModelList } from '../../../../../../api/chat'
import { buildProvidersState, toModelOption } from '../../../../../../page/HomePage/chatProviders'

it.each([true, false, undefined])('preserves API read_image=%s through options and providers', async flag => {
  mocks.getJson.mockResolvedValue({ model_items: [{ model_id: 'gpt-6.1-sol', name: 'GPT 6.1', ...(flag === undefined ? {} : { read_image: flag }) }] })
  const { modelItems } = await getChatModelList()
  expect(modelItems[0].read_image).toBe(flag)
  const options = modelItems.map(item => toModelOption(item.model_id, item.name, '', item.read_image))
  expect(buildProvidersState(options).llm.providers[0].models[0].read_image).toBe(flag)
})
