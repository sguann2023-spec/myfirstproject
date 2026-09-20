import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const readConfig = (name, instance) => {
  const source = readFileSync('src/main/services/agents/services/claudecode/tools/registry.ts', 'utf8');
  const config = source.match(new RegExp(`mountMcpServer\\('${name}', (\\{[\\s\\S]*?\\})\\)`))?.[1];
  if (!config) throw new Error(`Missing MCP config: ${name}`);
  return runInNewContext(`(${config})`, {
    socialCopywritingServer: { mcpServer: instance },
    imageGenerateServer: { createMcpServer: () => instance },
  });
};

afterEach(() => vi.useRealTimers());

describe('反推工具长任务超时', () => {
  it('MCP 注册配置与图片生成一致，为十分钟且支持长任务', () => {
    const image = readConfig('image', null);
    const copylab = readConfig('copylab', null);
    expect(copylab.longRunning).toBe(true);
    expect(copylab.longRunning).toBe(image.longRunning);
    expect(copylab.timeout).toBe(image.timeout);
    expect(copylab.timeout).toBe(600);
  });

  it('使用真实 MCP SDK 计时器，超过默认六十秒仍能完成', async () => {
    vi.useFakeTimers();
    const server = new McpServer({ name: 'copylab', version: 'test' }, { capabilities: { tools: {} } });
    server.server.setRequestHandler(CallToolRequestSchema, async () => {
      await new Promise((resolve) => setTimeout(resolve, 61_000));
      return { content: [{ type: 'text', text: 'completed' }] };
    });
    const config = readConfig('copylab', server);
    const client = new Client({ name: 'test', version: 'test' }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = client.callTool({ name: 'derive_copy_prompt', arguments: {} }, undefined, {
        timeout: config.timeout * 1000,
        resetTimeoutOnProgress: config.longRunning,
        maxTotalTimeout: config.timeout * 1000,
      });
      await vi.advanceTimersByTimeAsync(61_000);
      expect((await result).content[0].text).toBe('completed');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
