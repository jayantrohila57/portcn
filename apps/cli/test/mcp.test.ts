import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Portcn MCP stdio server', () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../dist/index.js', import.meta.url).pathname, 'mcp'],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'portcn-test-client', version: '1.0.0' });

  beforeAll(async () => {
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it('initializes and publishes validated read-only tool schemas', async () => {
    const result = await client.listTools();
    expect(result.tools.map(({ name }) => name).sort()).toEqual([
      'check_port_availability',
      'diagnose_port',
      'list_listeners',
      'suggest_ports',
    ]);
    const diagnosis = result.tools.find(({ name }) => name === 'diagnose_port');
    expect(diagnosis?.inputSchema).toMatchObject({
      type: 'object',
      required: ['port'],
      properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } },
    });
  });

  it('returns bounded structured availability results', async () => {
    const result = await client.callTool({ name: 'check_port_availability', arguments: { port: 3000 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      port: 3000,
      protocol: 'tcp',
      status: expect.stringMatching(/^(conflict-observed|no-conflict-observed|unknown)$/),
    });
    expect(JSON.stringify(result)).not.toMatch(/command|sessionId|environment/i);
  });

  it('returns structured tool errors for bounded input violations', async () => {
    const result = await client.callTool({ name: 'suggest_ports', arguments: { range: '1-65535', limit: 5 } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });
});
