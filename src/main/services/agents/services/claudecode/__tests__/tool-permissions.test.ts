import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMock = vi.fn()
const handleMock = vi.fn()
const getMainWindowMock = vi.fn(() => ({
  webContents: {
    send: sendMock
  }
}))

const deferredSave = () => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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

  it.each(['AskUserQuestion', 'builtin_AskUserQuestion'])(
    '%s broadcasts immediately and accepts answers while onQuestionReceived is still saving',
    async (toolName) => {
      const { promptForToolApproval } = await import('../tool-permissions')
      const save = deferredSave()
      const onQuestionReceived = vi.fn(() => save.promise)
      const controller = new AbortController()
      const input = { questions: [{ question: 'Where should we go?', options: [], multiSelect: false }] }
      const settled = vi.fn()

      const approvalPromise = promptForToolApproval(toolName, input, {
        signal: controller.signal,
        toolCallId: 'session-1:tool-save',
        rawToolCallId: 'tool-save',
        onQuestionReceived
      })
      void approvalPromise.then(settled)

      expect(onQuestionReceived).toHaveBeenCalledExactlyOnceWith(
        {
          toolName,
          toolCallId: 'session-1:tool-save',
          rawToolCallId: 'tool-save',
          aliases: ['tool-save'],
          input
        },
        controller.signal
      )
      expect(sendMock).toHaveBeenCalledTimes(1)
      const [channel, requestPayload] = sendMock.mock.calls[0]
      expect(channel).toBe('AgentToolPermission_Request')
      expect(requestPayload).toMatchObject({ toolName, toolCallId: 'session-1:tool-save', input })
      expect(settled).not.toHaveBeenCalled()

      const responseHandler = handleMock.mock.calls[0][1]
      const updatedInput = { ...input, answers: { 'Where should we go?': 'The park' } }
      await expect(
        responseHandler(null, { requestId: requestPayload.requestId, behavior: 'allow', updatedInput })
      ).resolves.toEqual({ success: true })
      await expect(approvalPromise).resolves.toEqual({ behavior: 'allow', updatedInput })
      expect(settled).toHaveBeenCalledTimes(1)

      save.resolve()
      await save.promise
      expect(sendMock).toHaveBeenCalledTimes(2)
    }
  )

  it.each(['reject', 'synchronous throw'])(
    'still broadcasts and accepts answers when onQuestionReceived fails with %s without an unhandled rejection',
    async (failureMode) => {
      const { promptForToolApproval } = await import('../tool-permissions')
      const save = deferredSave()
      const error = new Error('Question persistence failed')
      const onQuestionReceived = vi.fn(() => {
        if (failureMode === 'synchronous throw') throw error
        return save.promise
      })
      const unhandledRejection = vi.fn()
      process.on('unhandledRejection', unhandledRejection)

      try {
        const input = { questions: [{ question: 'Where should we go?', options: [], multiSelect: false }] }
        const approvalPromise = promptForToolApproval('AskUserQuestion', input, {
          signal: new AbortController().signal,
          toolCallId: 'session-1:tool-save-failure',
          onQuestionReceived
        })

        expect(onQuestionReceived).toHaveBeenCalledTimes(1)
        expect(sendMock).toHaveBeenCalledTimes(1)
        const [channel, requestPayload] = sendMock.mock.calls[0]
        expect(channel).toBe('AgentToolPermission_Request')
        if (failureMode === 'reject') save.reject(error)
        // Allow Node to report any unhandled rejection, not just flush microtasks.
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(unhandledRejection).not.toHaveBeenCalled()

        const responseHandler = handleMock.mock.calls[0][1]
        const updatedInput = { ...input, answers: { 'Where should we go?': 'The park' } }
        await expect(
          responseHandler(null, { requestId: requestPayload.requestId, behavior: 'allow', updatedInput })
        ).resolves.toEqual({ success: true })
        await expect(approvalPromise).resolves.toEqual({ behavior: 'allow', updatedInput })
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(unhandledRejection).not.toHaveBeenCalled()
      } finally {
        process.removeListener('unhandledRejection', unhandledRejection)
        save.resolve()
      }
    }
  )

  it('finalizes an abort while onQuestionReceived is still saving and rejects late answers', async () => {
    const { promptForToolApproval } = await import('../tool-permissions')
    const save = deferredSave()
    const onQuestionReceived = vi.fn(() => save.promise)
    const controller = new AbortController()

    const approvalPromise = promptForToolApproval('AskUserQuestion', { questions: [] }, {
      signal: controller.signal,
      toolCallId: 'session-1:tool-save-abort',
      onQuestionReceived
    })

    expect(onQuestionReceived).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const requestPayload = sendMock.mock.calls[0][1]

    controller.abort()
    await expect(approvalPromise).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool request aborted before user decision'
    })
    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(sendMock.mock.calls[1]).toEqual([
      'AgentToolPermission_Result',
      expect.objectContaining({ requestId: requestPayload.requestId, behavior: 'deny', reason: 'aborted' })
    ])

    save.resolve()
    await save.promise
    const responseHandler = handleMock.mock.calls[0][1]
    await expect(
      responseHandler(null, { requestId: requestPayload.requestId, behavior: 'allow', updatedInput: { answers: {} } })
    ).resolves.toEqual({ success: false, error: 'unknown-request' })
    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it('does not broadcast when onQuestionReceived synchronously aborts the request', async () => {
    const { promptForToolApproval } = await import('../tool-permissions')
    const controller = new AbortController()
    const onQuestionReceived = vi.fn(() => controller.abort())

    await expect(promptForToolApproval('AskUserQuestion', { questions: [] }, {
      signal: controller.signal,
      toolCallId: 'session-1:tool-received-abort',
      onQuestionReceived
    })).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool request was cancelled before prompting the user'
    })
    expect(onQuestionReceived).toHaveBeenCalledTimes(1)
    expect(sendMock).not.toHaveBeenCalled()
  })
})
