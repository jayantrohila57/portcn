import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { summarizeDiscoveryRelationships } from '@portcn/core';
import type { Command } from 'commander';
import { z } from 'zod/v4';
import packageJson from '../../package.json' with { type: 'json' };
import { checkPortAvailability, suggestAvailablePorts } from './availability.js';
import { diagnoseListeningPort } from './diagnose.js';
import { collectLinuxDiscoverySnapshot } from './discovery-coordinator.js';
import { discoverListeningPorts } from './list.js';

const MAX_LISTENERS = 100;
const MAX_SUGGESTIONS = 20;

type McpDependencies = {
  discover: typeof discoverListeningPorts;
  diagnose: typeof diagnoseListeningPort;
  availability: typeof checkPortAvailability;
  suggest: typeof suggestAvailablePorts;
};

const defaults: McpDependencies = {
  discover: discoverListeningPorts,
  diagnose: diagnoseListeningPort,
  availability: checkPortAvailability,
  suggest: suggestAvailablePorts,
};

function toolResult(data: unknown) {
  const json = JSON.stringify(data);
  return { content: [{ type: 'text' as const, text: json }], structuredContent: data as Record<string, unknown> };
}

function toolFailure(code: string, message: string) {
  return { ...toolResult({ error: { code, message } }), isError: true };
}

function safeFailure(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'InvalidPortError' || name === 'InvalidAvailabilityInputError')
    return toolFailure('INVALID_ARGUMENT', 'The requested port or availability options are invalid.');
  const message = error instanceof Error ? error.message : '';
  if (message.includes('supports Linux and macOS'))
    return toolFailure('UNSUPPORTED_PLATFORM', 'Port discovery currently supports Linux and macOS.');
  if (message.includes('command is missing'))
    return toolFailure('DISCOVERY_UNAVAILABLE', 'Port discovery requires ss on Linux or lsof on macOS.');
  if (message.includes('timed out'))
    return toolFailure('DISCOVERY_TIMEOUT', 'Port discovery exceeded its 10 second limit.');
  return toolFailure('DISCOVERY_FAILED', 'Port discovery failed in the current platform view.');
}

function boundedDiagnosis(port: number, diagnose: typeof diagnoseListeningPort) {
  const diagnosis = diagnose(port);
  return {
    schemaVersion: diagnosis.schemaVersion,
    port: diagnosis.port,
    namespace: diagnosis.namespace,
    listeners: diagnosis.listeners.slice(0, MAX_LISTENERS).map((listener) => ({
      protocol: listener.protocol,
      state: listener.state,
      bindAddress: listener.bindAddress,
      addressFamily: listener.addressFamily,
      owners: listener.owners.slice(0, 20).map((owner) => ({
        pid: owner.pid,
        processName: owner.processName,
        detailsStatus: owner.detailsStatus,
        project: {
          status: owner.projectContext.status,
          confidence: owner.projectContext.confidence,
          projectRoot: owner.projectContext.projectRoot,
          checkoutBranch: owner.projectContext.checkoutBranch,
          checkoutCommit: owner.projectContext.checkoutCommit,
          worktree: owner.projectContext.worktree,
        },
        agent: { status: owner.agentAttribution.status, confidence: owner.agentAttribution.confidence },
      })),
    })),
    messages: diagnosis.messages.slice(0, 100),
    limitations: diagnosis.limitations.slice(0, 20),
    truncated: diagnosis.listeners.length > MAX_LISTENERS,
  };
}

export function createPortcnMcpServer(dependencies: Partial<McpDependencies> = {}): McpServer {
  const deps = { ...defaults, ...dependencies };
  const server = new McpServer({ name: 'portcn', version: packageJson.version });

  server.registerTool(
    'list_listeners',
    {
      description:
        'List visible listening TCP and UDP sockets from the current Linux or macOS host view. Read-only snapshot; process command lines and environment values are never returned.',
      inputSchema: z.object({
        protocol: z.enum(['tcp', 'udp']).optional().describe('Limit results to one transport protocol.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LISTENERS)
          .optional()
          .describe('Maximum number of listeners to return (default 100).'),
      }),
    },
    async ({ protocol, limit = MAX_LISTENERS }) => {
      try {
        const all = deps.discover();
        const filtered = protocol ? all.filter((listener) => listener.protocol === protocol) : all;
        return toolResult({
          listeners: filtered.slice(0, limit).map((listener) => ({
            protocol: listener.protocol,
            state: listener.state,
            address: listener.address,
            port: listener.port,
            pid: listener.pid,
            processName: listener.processName,
            owners: (listener.owners ?? []).slice(0, 20),
          })),
          truncated: filtered.length > limit,
          limitations: [
            process.platform === 'linux'
              ? 'Snapshot covers only the current network namespace; no future bind is guaranteed.'
              : 'Snapshot covers sockets visible to the current macOS host process; no future bind is guaranteed.',
          ],
        });
      } catch (error) {
        return safeFailure(error);
      }
    },
  );

  server.registerTool(
    'diagnose_port',
    {
      description:
        'Inspect visible listener owners and best-effort Git project evidence for one port. Command lines, user IDs, paths outside the project root, agent names, session IDs, and environment values are omitted.',
      inputSchema: z.object({ port: z.number().int().min(1).max(65535) }),
    },
    async ({ port }) => {
      try {
        return toolResult(boundedDiagnosis(port, deps.diagnose));
      } catch (error) {
        return safeFailure(error);
      }
    },
  );

  server.registerTool(
    'check_port_availability',
    {
      description:
        'Check for observed TCP or UDP listener overlap on a local bind address. This does not reserve or bind the port.',
      inputSchema: z.object({
        port: z.number().int().min(1).max(65535),
        protocol: z.enum(['tcp', 'udp']).optional(),
        address: z.string().max(64).optional(),
      }),
    },
    async ({ port, protocol, address }) => {
      try {
        return toolResult(deps.availability(port, { protocol, address }));
      } catch (error) {
        return safeFailure(error);
      }
    },
  );

  if (process.platform === 'linux') {
    server.registerTool(
      'discovery_snapshot',
      {
        description:
          'Collect a bounded unified Linux discovery snapshot with evidence-backed service relationships. Read-only; existing per-command JSON contracts remain unchanged.',
        inputSchema: z.object({
          full: z.boolean().optional().describe('Include provider observations in addition to relationship summary.'),
          limit: z.number().int().min(1).max(200).optional().describe('Maximum relationships to return (default 100).'),
        }),
      },
      async ({ full = false, limit = 100 }) => {
        try {
          const snapshot = collectLinuxDiscoverySnapshot();
          const summary = summarizeDiscoveryRelationships(snapshot, { maxCorrelations: limit });
          const payload = full ? { ...summary, providers: snapshot.providers } : summary;
          return toolResult(payload);
        } catch (error) {
          return safeFailure(error);
        }
      },
    );
  }

  server.registerTool(
    'suggest_ports',
    {
      description:
        'Suggest ports with no observed listener overlap in a bounded local range. Suggestions are not reserved.',
      inputSchema: z.object({
        range: z
          .string()
          .regex(/^\d+-\d+$/)
          .optional(),
        from: z.number().int().min(1).max(65535).optional(),
        limit: z.number().int().min(1).max(MAX_SUGGESTIONS).optional(),
        protocol: z.enum(['tcp', 'udp']).optional(),
        address: z.string().max(64).optional(),
      }),
    },
    async ({ range, from, limit, protocol, address }) => {
      try {
        return toolResult(
          deps.suggest({
            range,
            from: from === undefined ? undefined : String(from),
            limit: limit === undefined ? undefined : String(limit),
            protocol,
            address,
          }),
        );
      } catch (error) {
        return safeFailure(error);
      }
    },
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const handle = serveStdio(() => createPortcnMcpServer(), {
    onerror: (error) => process.stderr.write(`portcn mcp: ${error.name}\n`),
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void handle.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

export function registerMcpCommand(program: Command): void {
  program.command('mcp').description('Run the read-only Model Context Protocol server over stdio').action(runMcpServer);
}
