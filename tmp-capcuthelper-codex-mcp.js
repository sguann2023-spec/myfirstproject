#!/usr/bin/env node
'use strict';

(async () => {
  const baseUrl = process.env.CAPCUTHELPER_MCP_BASE_URL || 'http://127.0.0.1:23333';
  const apiKey = process.env.CAPCUTHELPER_MCP_API_KEY || '';
  const agentId = process.env.CAPCUTHELPER_MCP_AGENT_ID || 'codex_cli';
  const headers = apiKey ? { Authorization: \`Bearer \${apiKey}\` } : {};

  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } = await import('@modelcontextprotocol/sdk/types.js');

  const clients = new Map();
  const toolMappings = new Map();

  async function fetchExposedServers() {
    const response = await fetch(\`\${baseUrl}/v1/mcps/exposed/\${encodeURIComponent(agentId)}/servers\`, { headers });
    if (!response.ok) {
      throw new Error(\`Failed to fetch exposed servers: \${response.status}\`);
    }
    const payload = await response.json();
    return Array.isArray(payload?.data?.servers) ? payload.data.servers : [];
  }

  async function getClient(serverId) {
    const cached = clients.get(serverId);
    if (cached) {
      return cached;
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(\`\${baseUrl}/v1/mcps/exposed/\${encodeURIComponent(agentId)}/\${encodeURIComponent(serverId)}/mcp\`),
      {
        requestInit: {
          headers
        }
      }
    );
    const client = new Client({ name: 'capcuthelper-codex-bridge', version: '0.1.0' });
    await client.connect(transport);
    clients.set(serverId, client);
    return client;
  }

  async function buildTools() {
    const servers = await fetchExposedServers();
    const tools = [];
    toolMappings.clear();

    for (const server of servers) {
      const client = await getClient(server.id);
      const result = await client.listTools();
      for (const tool of Array.isArray(result?.tools) ? result.tools : []) {
        const bridgedName = \`\${server.id}__\${tool.name}\`;
        toolMappings.set(bridgedName, { serverId: server.id, toolName: tool.name });
        tools.push({
          ...tool,
          name: bridgedName,
          description: tool.description ? \`[\${server.name || server.id}] \${tool.description}\` : \`[\${server.name || server.id}]\`
        });
      }
    }

    return tools;
  }

  const server = new Server({ name: 'capcuthelper-desktop', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: await buildTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params?.name;
    if (!toolName) {
      throw new McpError(ErrorCode.InvalidRequest, 'Missing tool name');
    }

    let target = toolMappings.get(toolName);
    if (!target) {
      await buildTools();
      target = toolMappings.get(toolName);
    }

    if (!target) {
      throw new McpError(ErrorCode.MethodNotFound, \`Tool not found: \${toolName}\`);
    }

    const client = await getClient(target.serverId);
    return client.callTool({
      ...request.params,
      name: target.toolName
    });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
})().catch((error) => {
  console.error('[capcuthelper-codex-mcp]', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
