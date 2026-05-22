import type { CollapseProps } from 'antd'
import { CheckCircle, Circle, Loader2 } from 'lucide-react'

import { ToolHeader } from './GenericTools'
import { AgentToolsType, type TodoItem, type TodoWriteToolInput } from './types'

const TodoStatusIcon = ({ status }: { status: TodoItem['status'] }) => {
  switch (status) {
    case 'completed':
      return <CheckCircle size={14} className="shrink-0 text-green-500" />
    case 'in_progress':
      return <Loader2 size={14} className="shrink-0 animate-spin text-blue-500" />
    case 'pending':
    default:
      return <Circle size={14} className="shrink-0 text-gray-400" />
  }
}

export function TodoWriteTool({
  input
}: {
  input?: TodoWriteToolInput
}): NonNullable<CollapseProps['items']>[number] {
  const todos = input?.todos ?? []
  const completedCount = todos.filter((todo) => todo.status === 'completed').length
  const activeTodo = todos.find((todo) => todo.status === 'in_progress') ?? todos.find((todo) => todo.status === 'pending')

  return {
    key: AgentToolsType.TodoWrite,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TodoWrite}
        params={activeTodo ? `${activeTodo.status === 'in_progress' ? activeTodo.activeForm : activeTodo.content}` : undefined}
        stats={todos.length > 0 ? `${completedCount}/${todos.length}` : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="flex flex-col gap-2">
        {todos.length > 0 ? (
          todos.map((todo, index) => (
            <div
              key={`${todo.content}-${index}`}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                todo.status === 'completed' ? 'opacity-60' : ''
              }`}>
              <TodoStatusIcon status={todo.status} />
              <span className={todo.status === 'completed' ? 'line-through' : ''}>
                {todo.status === 'in_progress' ? todo.activeForm : todo.content}
              </span>
            </div>
          ))
        ) : (
          <div className="px-2 py-1 text-foreground-500 text-sm">No todo items</div>
        )}
      </div>
    )
  }
}
