import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMock = vi.fn()
const handleMock = vi.fn()
const getMainWindowMock = vi.fn(() => ({
  webContents: {
    send: sendMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: {
    AgentToolPermission_Request: 'AgentToolPermission_Request',
    AgentToolPermission_Result: 'AgentToolPermission_Result',
    AgentToolPermission_Response: 'AgentToolPermission_Response'
  }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock
  }
}))

vi.mock('../../../../WindowService', () => ({
  windowService: {
    getMainWindow: getMainWindowMock
  }
}))

describe('promptForToolApproval', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.CHERRY_AUTO_ALLOW_TOOLS = '1'
  })

  it('auto-approves non-interactive tools when auto allow is enabled', async () => {
    const { promptForToolApproval } = await import('../tool-permissions')
    const input = { file_path: '/tmp/example.txt' }

    await expect(
      promptForToolApproval('Read', input, {
        signal: new AbortController().signal,
        toolCallId: 'session-1:tool-1'
      })
    ).resolves.toEqual({
      behavior: 'allow',
      updatedInput: input
    })

    expect(handleMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('still prompts for AskUserQuestion even when auto allow is enabled', async () => {
    let responseHandler: ((event: unknown, payload: any) => Promise<{ success: boolean; error?: string }>) | undefined
    handleMock.mockImplementation((_channel, handler) => {
      responseHandler = handler
    })

    const { promptForToolApproval } = await import('../tool-permissions')
    const input = {
      questions: [
        {
          question: '您想去哪里？',
          header: '旅游',
          options: [
            { label: '故宫', description: '看古建' },
            { label: '长城', description: '看风景' }
          ],
          multiSelect: false
        }
      ]
    }

    const approvalPromise = promptForToolApproval('AskUserQuestion', input, {
      signal: new AbortController().signal,
      toolCallId: 'session-1:tool-ask'
    })

    expect(handleMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledTimes(1)

    const [channel, requestPayload] = sendMock.mock.calls[0]
    expect(typeof channel).toBe('string')
    expect(requestPayload.toolName).toBe('AskUserQuestion')
    expect(requestPayload.toolCallId).toBe('session-1:tool-ask')
    expect(requestPayload.input).toEqual(input)
    expect(responseHandler).toBeTypeOf('function')

    const updatedInput = {
      ...input,
      answers: {
        '您想去哪里？': '长城'
      }
    }

    await expect(
      responseHandler?.(null, {
        requestId: requestPayload.requestId,
        behavior: 'allow',
        updatedInput
      })
    ).resolves.toEqual({ success: true })

    await expect(approvalPromise).resolves.toEqual({
      behavior: 'allow',
      updatedInput
    })
  })
})
