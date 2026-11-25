import { readlinkSync } from 'node:fs';
import { isIP } from 'node:net';
import type { Command } from 'commander';
import { formatEmpty, formatTable } from '../terminal.js';
import { type AgentAttribution, inspectAgentAttribution } from './agent-attribution.js';
import { InvalidPortError, inspectProcessDetails, type ProcessDetailStatus, parsePort } from './inspect.js';
import { JSON_SCHEMA_VERSION, jsonSchemaIsSupported, UnsupportedJsonVersionError, versionedJsonError } from './json.js';
import { discoverListeningPorts, type ListeningOwner, type ListeningPort } from './list.js';
import { inspectProjectContext, type ProjectContext } from './project-context.js';

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export interface DiagnosedOwner {
  pid: number;
  processName: string;
  command: string | null;
  user: string | null;
  detailsStatus: ProcessDetailStatus;
  projectContext: ProjectContext;
  agentAttribution: AgentAttribution;
}

export interface DiagnosedListener {
  protocol: ListeningPort['protocol'];
  state: string;
  bindAddress: string;
  addressFamily: 'IPv4' | 'IPv6' | 'unknown';
  owners: DiagnosedOwner[];
}

export interface PortDiagnosis {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  port: number;
  namespace: {
    network: string | null;
    pid: string | null;
  };
  listeners: DiagnosedListener[];
  messages: string[];
  limitations: string[];
}

export interface DiagnosisOptions {
  discover?: () => ListeningPort[];
  inspectProcess?: (pid: number) => ReturnType<typeof inspectProcessDetails>;
  inspectProject?: (pid: number) => ProjectContext;
  inspectAgent?: (pid: number, ancestors: ProjectContext['ancestors']) => AgentAttribution;
  readNamespace?: (namespace: 'net' | 'pid') => string | null;
}

export function readCurrentNamespace(namespace: 'net' | 'pid'): string | null {
  try {
    return readlinkSync(`/proc/self/ns/${namespace}`);
  } catch {
    return null;
  }
}

function familyForAddress(address: string): DiagnosedListener['addressFamily'] {
  const unwrapped = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const withoutInterface = unwrapped.split('%', 1)[0] ?? unwrapped;
  const family = isIP(withoutInterface);
  if (family === 4) return 'IPv4';
  if (family === 6) return 'IPv6';
  return 'unknown';
}

function ownersFor(listener: ListeningPort): ListeningOwner[] {
  if (listener.owners)
    return [...listener.owners].sort(
      (left, right) => left.pid - right.pid || compareText(left.processName, right.processName),
    );
  if (listener.pid !== null && listener.processName !== null)
    return [{ pid: listener.pid, processName: listener.processName }];
  return [];
}

function ownerMessage(listener: DiagnosedListener, owner: DiagnosedOwner, port: number): string | null {
  const socket = `${listener.protocol.toUpperCase()} ${listener.bindAddress}:${port}`;
  switch (owner.detailsStatus) {
    case 'permission-denied':
      return `Process details for PID ${owner.pid} were blocked by permissions (${socket}); inspect it as a user allowed to read that process if more detail is needed.`;
    case 'process-exited':
      return `PID ${owner.pid} exited or became inaccessible during diagnosis; rerun the command to refresh the snapshot.`;
    case 'unavailable':
      return `Additional details for PID ${owner.pid} could not be read (${socket}); the visible PID and process name are still reported.`;
    default:
      return null;
  }
}

export function diagnoseListeningPort(port: number, options: DiagnosisOptions = {}): PortDiagnosis {
  const discover = options.discover ?? (() => discoverListeningPorts());
  const inspectProcess = options.inspectProcess ?? inspectProcessDetails;
  const inspectProject = options.inspectProject ?? inspectProjectContext;
  const inspectAgent = options.inspectAgent ?? inspectAgentAttribution;
  const readNamespace = options.readNamespace ?? readCurrentNamespace;
  const namespace = { network: readNamespace('net'), pid: readNamespace('pid') };
  const visiblePorts = discover()
    .filter((listener) => listener.port === port)
    .sort(
      (left, right) =>
        compareText(left.protocol, right.protocol) ||
        compareText(familyForAddress(left.address), familyForAddress(right.address)) ||
        compareText(left.address, right.address) ||
        compareText(left.state, right.state) ||
        (left.pid ?? 0) - (right.pid ?? 0),
    );
  const listeners = visiblePorts.map<DiagnosedListener>((listener) => ({
    protocol: listener.protocol,
    state: listener.state,
    bindAddress: listener.address,
    addressFamily: familyForAddress(listener.address),
    owners: ownersFor(listener).map((owner) => {
      const details = inspectProcess(owner.pid);
      const projectContext = inspectProject(owner.pid);
      return {
        ...owner,
        command: details.details?.command ?? null,
        user: details.details?.user ?? null,
        detailsStatus: details.status,
        projectContext,
        agentAttribution: inspectAgent(owner.pid, projectContext.ancestors),
      };
    }),
  }));

  const messages =
    listeners.length === 0
      ? [
          `No listeners are visible on port ${port} in the current network namespace; this snapshot cannot guarantee a future bind.`,
        ]
      : [
          `Found ${listeners.length} listening socket${listeners.length === 1 ? '' : 's'} on port ${port}. Compare protocol, address, and IPv4/IPv6 behavior with the server you plan to start.`,
        ];

  for (const listener of listeners) {
    if (listener.owners.length === 0) {
      messages.push(
        `No process owner is visible for ${listener.protocol.toUpperCase()} ${listener.bindAddress}:${port}; permissions or process-namespace boundaries may hide it.`,
      );
    }
    for (const owner of listener.owners) {
      const message = ownerMessage(listener, owner, port);
      if (message) messages.push(message);
    }
  }

  const limitations = [
    namespace.network
      ? `Socket discovery is limited to the current network namespace (${namespace.network}); the host and other network namespaces are not inspected.`
      : 'The current network namespace could not be identified; discovery still covers only the namespace visible to this process.',
    namespace.pid
      ? `PIDs and /proc details use the current PID namespace (${namespace.pid}); other PID namespaces may expose different or incomplete process information.`
      : 'The current PID namespace could not be identified; process IDs are reported as provided by the current namespace.',
    'This is a read-only point-in-time snapshot. A listener can stop or a new process can bind after diagnosis completes.',
  ];

  return { schemaVersion: JSON_SCHEMA_VERSION, port, namespace, listeners, messages, limitations };
}

export function formatDiagnosis(diagnosis: PortDiagnosis): string {
  const rows = diagnosis.listeners.flatMap((listener) => {
    const owners = listener.owners.length ? listener.owners : [null];
    return owners.map((owner) => [
      listener.protocol.toUpperCase(),
      listener.state,
      listener.addressFamily,
      listener.bindAddress,
      owner ? String(owner.pid) : '-',
      owner?.processName ?? 'unknown',
      owner?.command ?? '-',
      owner?.user ?? '-',
      owner?.detailsStatus ?? 'owner hidden',
      owner?.projectContext.projectRoot ?? 'unknown project',
      owner?.projectContext.status ?? 'unknown',
      owner?.agentAttribution.agentName ?? owner?.agentAttribution.status ?? 'unknown agent',
    ]);
  });
  const lines = [`Port diagnosis: ${diagnosis.port}`, ...diagnosis.messages];
  if (rows.length) {
    lines.push(
      formatTable(
        [
          'PROTO',
          'STATE',
          'FAMILY',
          'BIND ADDRESS',
          'PID',
          'PROCESS',
          'COMMAND',
          'USER',
          'DETAILS',
          'PROJECT',
          'PROJECT STATUS',
          'AGENT',
        ],
        rows,
        {
          columnWidths: [6, 8, 7, 24, 8, 16, 32, 12, 17, 30, 12, 16],
          columnColors: { 0: '\u001b[36m', 1: '\u001b[32m' },
        },
      ),
    );
  } else {
    lines.push(formatEmpty('No visible listeners.'));
  }
  lines.push('Limitations:', ...diagnosis.limitations.map((limitation) => `- ${limitation}`));
  return lines.join('\n');
}

export function registerDiagnoseCommand(
  program: Command,
  runDiagnosis: typeof diagnoseListeningPort = diagnoseListeningPort,
): void {
  program
    .command('diagnose <port>')
    .description('Explain visible listeners and ownership limits for a port (Linux)')
    .option('--json', 'Print the complete diagnosis as JSON')
    .option('--json-version <version>', 'Print versioned JSON (supported: 1)')
    .action((value: string, options: { json?: boolean; jsonVersion?: string }) => {
      try {
        if (!jsonSchemaIsSupported(options.jsonVersion)) throw new UnsupportedJsonVersionError();
        const port = parsePort(value);
        const diagnosis = runDiagnosis(port);
        process.stdout.write(
          `${options.json || options.jsonVersion !== undefined ? JSON.stringify(diagnosis) : formatDiagnosis(diagnosis)}\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const invalidPort = error instanceof InvalidPortError;
        if (options.jsonVersion !== undefined) {
          process.stdout.write(`${JSON.stringify(versionedJsonError(error, value))}\n`);
        } else if (options.json) {
          process.stdout.write(
            `${JSON.stringify({ error: { code: invalidPort ? 'INVALID_PORT' : 'DIAGNOSIS_FAILED', message, port: value } })}\n`,
          );
        } else {
          process.stderr.write(`portcn: ${message}\n`);
        }
        process.exitCode = invalidPort || error instanceof UnsupportedJsonVersionError ? 2 : 1;
      }
    });
}
