import { classifyErrorByAI } from '@renderer/services/ErrorDiagnosisService'
import { restartTrace } from '@renderer/services/SpanManagerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { regenerateAssistantResponseThunk } from '@renderer/store/thunk/messageThunk'
import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'
import type { ErrorClassification } from '@renderer/utils/errorClassifier'
import { CircleAlert, LoaderCircle, X } from 'lucide-react'
import React, { useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import './ErrorRecoveryBlock.css'
import { MessageRetryContext } from './MessageRetryContext'
import NetworkCheck from '../../../../../../components/Chat/NetworkCheck/NetworkCheck'

interface Props {
  block: ErrorMessageBlock
  message: Message
  classification: ErrorClassification
}

const summaryCache = new Map<string, Promise<string>>()

const ErrorRecoveryBlock: React.FC<Props> = ({ block, message, classification }) => {
  const { t, i18n } = useTranslation()
  const dispatch = useAppDispatch()
  const hostRetry = useContext(MessageRetryContext)
  const assistant = useAppSelector((state) =>
    state.assistants.assistants.find((item) => item.id === message.assistantId)
  )
  const defaultModel = useAppSelector((state) => state.llm.defaultModel)
  const topicLoading = useAppSelector((state) => !!state.messages.loadingByTopic[message.topicId])
  const [dismissed, setDismissed] = useState(false)
  const [networkCheckOpen, setNetworkCheckOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [summary, setSummary] = useState({ key: '', text: '' })
  const retryLock = useRef(false)
  const retryDisabled = retrying || message.role !== 'assistant' || (
    hostRetry ? hostRetry.disabled : topicLoading || !assistant || !message.askId
  )
  const needsExplanation = classification.i18nKey === 'error.diagnosis.unknown'
  const errorMessage = block.error?.message?.trim() || ''
  const summaryKey = JSON.stringify([block.error?.name, errorMessage, i18n.language])
  const aiSummary = needsExplanation && summary.key === summaryKey ? summary.text : ''
  const titleKey = needsExplanation
    ? 'error.diagnosis.unknown_failure'
    : classification.i18nKey === 'error.diagnosis.network'
      ? 'error.diagnosis.network_failure'
      : classification.i18nKey

  useEffect(() => {
    if (!needsExplanation || !errorMessage || !block.error) return
    let cancelled = false
    if (summaryCache.size >= 100) summaryCache.clear()
    const pending = summaryCache.get(summaryKey) ??
      classifyErrorByAI(block.error, i18n.language).catch(() => '')
    summaryCache.set(summaryKey, pending)
    void pending.then((text) => {
      if (!text) summaryCache.delete(summaryKey)
      if (!cancelled) setSummary({ key: summaryKey, text })
    })
    return () => {
      cancelled = true
    }
  }, [needsExplanation, errorMessage, summaryKey, block.error, i18n.language])

  const errorCode = block.error?.code ?? block.error?.statusCode ?? block.error?.status
  const traceId = block.error?.traceId ?? block.error?.trace_id ?? message.traceId
  const details = [
    typeof errorCode === 'string' || typeof errorCode === 'number' ? String(errorCode) : '',
    typeof traceId === 'string' && traceId ? `Trace ID: ${traceId}` : ''
  ]
    .filter(Boolean)
    .join('  |  ')

  const onRetry = async () => {
    if (retryDisabled || retryLock.current) return
    retryLock.current = true
    setRetrying(true)
    try {
      if (hostRetry) {
        await hostRetry.onRetry()
        return
      }
      if (!assistant) return
      await restartTrace(message)
      await dispatch(
        regenerateAssistantResponseThunk(message.topicId, message, {
          ...assistant,
          model: assistant.model ?? assistant.defaultModel ?? defaultModel
        })
      )
    } catch {
      window.toast.error(t('error.diagnosis.retry_failed'))
    } finally {
      retryLock.current = false
      setRetrying(false)
    }
  }

  return (
    <div className="error-recovery">
      <p className="error-recovery__reply">
        {t('error.diagnosis.recovery_reply')}
      </p>
      {!dismissed && (
        <div
          role="alert"
          className="error-recovery__banner">
          <button
            type="button"
            aria-label={t('common.close')}
            className="error-recovery__close"
            onClick={() => setDismissed(true)}>
            <X size={16} />
          </button>
          <div className="error-recovery__header">
            <CircleAlert size={16} className="error-recovery__icon" />
            <div className="error-recovery__content">
              <div className="error-recovery__title">
                {aiSummary || t(titleKey)}
              </div>
              {needsExplanation && (
                <div className="error-recovery__reason">
                  {errorMessage
                    ? <>{t('error.diagnosis.error_reason')}{errorMessage}</>
                    : t('error.diagnosis.missing_reason')}
                </div>
              )}
              {details && <div className="error-recovery__metadata">{details}</div>}
            </div>
          </div>
          <div className="error-recovery__actions">
            <button
              type="button"
              className="error-recovery__retry"
              aria-busy={retrying}
              disabled={retryDisabled}
              onClick={onRetry}>
              {retrying && <LoaderCircle size={13} className="error-recovery__spinner" aria-hidden="true" />}
              {t('common.retry')}
            </button>
            <button
              type="button"
              className="error-recovery__retry error-recovery__network"
              onClick={() => setNetworkCheckOpen(true)}>
              {t('network_check.button')}
            </button>
          </div>
        </div>
      )}
      {networkCheckOpen && (
        <NetworkCheck
          modelId={hostRetry?.modelId || (message.model?.provider
            ? `${message.model.provider}:${message.model.id}` : message.model?.id)}
          onClose={() => setNetworkCheckOpen(false)}
        />
      )}
    </div>
  )
}

export default ErrorRecoveryBlock
