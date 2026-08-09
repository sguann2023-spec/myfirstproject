import { useAppDispatch, useAppSelector } from '@renderer/store'
import { removeBlocksThunk } from '@renderer/store/thunk/messageThunk'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Typography } from 'antd'
import { LoadingIcon } from '@renderer/components/Icons'
import { CheckCircle, ChevronDown, ChevronUp, Circle, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { TodoItem } from '../../Messages/Tools/MessageAgentTools/types'
import { useActiveTodos } from '../hooks/useActiveTodos'

const { Text } = Typography

const TodoStatusIcon: FC<{ status: TodoItem['status']; sessionActive?: boolean }> = ({ status, sessionActive = false }) => {
  switch (status) {
    case 'completed':
      return <CheckCircle size={14} style={{ color: '#98E0AC' }} />
    case 'in_progress':
      return sessionActive ? (
        <LoadingIcon size={14} style={{ color: 'var(--color-primary)' }} />
      ) : (
        <Circle size={14} style={{ color: 'var(--color-primary)' }} />
      )
    case 'pending':
    default:
      return <Circle size={14} style={{ color: 'var(--color-text-3)' }} />
  }
}

interface PinnedTodoPanelProps {
  topicId: string
  sessionActive?: boolean
  sessionFulfilled?: boolean
}

export const PinnedTodoPanel: FC<PinnedTodoPanelProps> = ({
  topicId,
  sessionActive = false,
  sessionFulfilled = false
}) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const activeTodoInfo = useActiveTodos(topicId)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const resolvedSessionActive = useAppSelector((state) => {
    if (sessionActive) {
      return true
    }

    const loadingByTopic = state.messages.loadingByTopic
    if (loadingByTopic[topicId]) {
      return true
    }

    if (!activeTodoInfo) {
      return false
    }

    return Object.keys(activeTodoInfo.blockIdsByMessage).some((messageId) => {
      const message = state.messages.entities[messageId]
      if (!message) {
        return false
      }

      if (loadingByTopic[message.topicId]) {
        return true
      }

      const agentSessionId = message.agentSessionId?.trim()
      return agentSessionId ? Boolean(loadingByTopic[buildAgentSessionTopicId(agentSessionId)]) : false
    })
  })

  const handleClose = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (activeTodoInfo) {
        // Batch all removals with Promise.all to ensure they complete before unmounting
        await Promise.all(
          Object.entries(activeTodoInfo.blockIdsByMessage).map(([messageId, blockIds]) =>
            dispatch(removeBlocksThunk(topicId, messageId, blockIds))
          )
        )
      }
    },
    [dispatch, topicId, activeTodoInfo]
  )

  if (!activeTodoInfo) {
    return null
  }

  const { todos } = activeTodoInfo
  const incompleteCount = todos.filter((todo: TodoItem) => todo.status !== 'completed').length
  const displayTodos =
    sessionFulfilled && incompleteCount === 1
      ? todos.map((todo: TodoItem) =>
          todo.status === 'completed'
            ? todo
            : {
                ...todo,
                status: 'completed' as const
              }
        )
      : todos
  const displayActiveTodo =
    displayTodos.find((todo: TodoItem) => todo.status === 'in_progress') ??
    displayTodos.find((todo: TodoItem) => todo.status === 'pending')
  const displayCompletedCount = displayTodos.filter((todo: TodoItem) => todo.status === 'completed').length
  const displayTotalCount = displayTodos.length

  return (
    <Container>
      <PanelBody>
        <PanelHeader onClick={() => setIsCollapsed(!isCollapsed)}>
          <HeaderLeft>
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {isCollapsed && displayActiveTodo ? (
              <>
                  <TodoStatusIcon status={displayActiveTodo.status} sessionActive={resolvedSessionActive} />
                <HeaderTitle>
                    {displayActiveTodo.status === 'in_progress' && resolvedSessionActive
                    ? displayActiveTodo.activeForm
                    : displayActiveTodo.content}
                </HeaderTitle>
              </>
            ) : (
              <HeaderTitle>{t('agent.todo.panel.title', { completed: displayCompletedCount, total: displayTotalCount })}</HeaderTitle>
            )}
          </HeaderLeft>
          <CloseButton onClick={handleClose}>
            <X size={14} />
          </CloseButton>
        </PanelHeader>
        <TodoList $collapsed={isCollapsed}>
          {displayTodos.map((todo: TodoItem, index: number) => (
            <TodoItemRow key={`${todo.content}-${index}`} $completed={todo.status === 'completed'}>
                <TodoStatusIcon status={todo.status} sessionActive={resolvedSessionActive} />
              <TodoContent $completed={todo.status === 'completed'}>
                  {todo.status === 'in_progress' && resolvedSessionActive ? todo.activeForm : todo.content}
              </TodoContent>
            </TodoItemRow>
          ))}
        </TodoList>
      </PanelBody>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
`

const PanelBody = styled.div`
  border-radius: 17px;
  border: 0.5px solid var(--color-border);
  overflow: hidden;
  background-color: var(--color-background-opacity);

  body[theme-mode='dark'] & {
    background-color: var(--color-background-mute);
  }
`

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-2);
`

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const CloseButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-3);
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-1);
    background-color: var(--color-fill-2);
  }
`

const HeaderTitle = styled(Text)`
  font-weight: 500;
  font-size: 12px;
`

const TodoList = styled.div<{ $collapsed: boolean }>`
  max-height: ${(props) => (props.$collapsed ? '0px' : '200px')};
  overflow-y: auto;
  transition: max-height 0.2s ease;
`

const TodoItemRow = styled.div<{ $completed: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border-top: 0.5px solid var(--color-border);
  opacity: ${(props) => (props.$completed ? 0.6 : 1)};
`

const TodoContent = styled.span<{ $completed: boolean }>`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration: ${(props) => (props.$completed ? 'line-through' : 'none')};
`
