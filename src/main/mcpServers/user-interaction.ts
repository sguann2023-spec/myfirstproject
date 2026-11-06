import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { USER_INTERACTION_SCHEMA, USER_INTERACTION_SERVER, USER_INTERACTION_TOOL } from '@shared/userInteraction'
import { normalizeAskUserQuestionInput } from '@shared/askUserQuestion'

/** Human waiting happens in the permission gate, before starting the MCP RPC. */
export default class UserInteractionServer {
  public mcpServer = new McpServer({ name: USER_INTERACTION_SERVER, version: '1.0.0' }, { capabilities: { tools: {} } })
  constructor() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
      name: USER_INTERACTION_TOOL, description: 'Ask the user for choices, text or local uploads and wait for their answer. Supports grouped choices and conditional text/upload inputs on selected options.', inputSchema: USER_INTERACTION_SCHEMA
    }] }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async request => {
      if (request.params.name !== USER_INTERACTION_TOOL) throw new Error('Unknown user interaction tool')
      const args = normalizeAskUserQuestionInput(request.params.arguments ?? {})
      if (!args.answers || typeof args.answers !== 'object' || !Object.keys(args.answers).length) {
        return { isError: true, content: [{ type: 'text', text: 'User answer missing: interaction must pass the permission gate before execution.' }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ questions: args.questions, answers: args.answers, structuredAnswers: args.structuredAnswers }) }] }
    })
  }
}
