import { readlinkSync } from 'node:fs';
import type { Command } from 'commander';
import { formatEmpty } from '../terminal.js';
import { type AgentAttribution, inspectAgentAttribution } from './agent-attribution.js';
import {
  InvalidProcessAssessmentInputError,
  JSON_SCHEMA_VERSION,
  jsonSchemaIsSupported,
  UnsupportedJsonVersionError,
  versionedJsonError,
} from './json.js';
import {
  type GitMetadata,
  inspectProjectContext,
  type ProjectContext,
  readProcessStartTime,
  resolveGitProject,
} from './project-context.js';

export type ProcessOwnershipStatus = 'matching' | 'different' | 'ambiguous' | 'unknown';

export interface ProcessOwnershipAssessment {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  status: ProcessOwnershipStatus;
  pid: number;
  identity: { startTime: string | null; stable: boolean };
  expectedProject: string;
  expectedSessionId: string | null;
  processProject: ProjectContext | null;
  agentAttribution: AgentAttribution | null;
  matchingEvidence: string[];
  differentEvidence: string[];
  observedAt: string;
  pidNamespace: string | null;
  limitations: string[];
  message: string;
}

export interface ProcessAssessmentDependencies {
  resolveProject?: (directory: string) => GitMetadata | null;
  readStartTime?: (pid: number) => string | null;
  inspectProject?: (pid: number) => ProjectContext;
  inspectAgent?: (pid: number, ancestors: ProjectContext['ancestors']) => AgentAttribution;
  now?: () => Date;
  readPidNamespace?: () => string | null;
}

const safeSessionId = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,79}$/;

function assessment(
  status: ProcessOwnershipStatus,
  pid: number,
  startTime: string | null,
  stable: boolean,
  expectedProject: string,
  expectedSessionId: string | null,
  processProject: ProjectContext | null,
  agentAttribution: AgentAttribution | null,
  matchingEvidence: string[],
  differentEvidence: string[],
  observedAt: string,
  pidNamespace: string | null,
): ProcessOwnershipAssessment {
  const message =
    status === 'matching'
      ? `PID ${pid} has visible evidence matching the supplied project${expectedSessionId ? ' and session' : ''}. This is an advisory snapshot, not permission to stop the process.`
      : status === 'different'
        ? `PID ${pid} has visible evidence that differs from the supplied project or session. This is an advisory snapshot.`
        : status === 'ambiguous'
          ? `PID ${pid} has conflicting ownership evidence; do not assume it belongs to the supplied project or session.`
          : `Ownership of PID ${pid} could not be established from visible evidence.`;
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    status,
    pid,
    identity: { startTime, stable },
    expectedProject,
    expectedSessionId,
    processProject,
    agentAttribution,
    matchingEvidence,
    differentEvidence,
    observedAt,
    pidNamespace,
    limitations: [
      'This read-only snapshot is limited to processes visible in the current PID namespace and user permissions.',
      'A process can exit or change ownership after the observation; stable PID/start-time identity is not a future guarantee.',
      'This advisory never authorizes stopping or signaling a process.',
    ],
    message,
  };
}

export function assessProcessOwnership(
  pid: number,
  projectDirectory: string,
  sessionId?: string,
  dependencies: ProcessAssessmentDependencies = {},
): ProcessOwnershipAssessment {
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new InvalidProcessAssessmentInputError('PID must be a positive integer.');
  if (!projectDirectory.trim()) throw new InvalidProcessAssessmentInputError('A Git project path is required.');
  if (sessionId !== undefined && !safeSessionId.test(sessionId))
    throw new InvalidProcessAssessmentInputError('Session ID must be 1-80 safe characters.');
  const resolveProject = dependencies.resolveProject ?? resolveGitProject;
  const expected = resolveProject(projectDirectory);
  if (!expected)
    throw new InvalidProcessAssessmentInputError(
      'Expected project path must exist and resolve inside a Git repository.',
    );
  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  let pidNamespace: string | null = null;
  try {
    pidNamespace = (dependencies.readPidNamespace ?? (() => readlinkSync('/proc/self/ns/pid')))();
  } catch {
    pidNamespace = null;
  }
  const readStartTime = dependencies.readStartTime ?? readProcessStartTime;
  const startTime = readStartTime(pid);
  if (startTime === null)
    return assessment(
      'unknown',
      pid,
      null,
      false,
      expected.projectRoot,
      sessionId ?? null,
      null,
      null,
      [],
      ['The process identity is not visible; it may have exited or be permission-limited.'],
      observedAt,
      pidNamespace,
    );

  const inspectProject = dependencies.inspectProject ?? inspectProjectContext;
  const inspectAgent = dependencies.inspectAgent ?? inspectAgentAttribution;
  const processProject = inspectProject(pid);
  const agentAttribution = inspectAgent(pid, processProject.ancestors);
  const finalStartTime = readStartTime(pid);
  if (finalStartTime === null || finalStartTime !== startTime)
    return assessment(
      'unknown',
      pid,
      startTime,
      false,
      expected.projectRoot,
      sessionId ?? null,
      null,
      null,
      [],
      ['The process exited or its PID was reused during assessment; collected evidence was discarded.'],
      observedAt,
      pidNamespace,
    );

  const matchingEvidence =
    processProject.status === 'identified' && processProject.projectRoot === expected.projectRoot
      ? [
          `Git project root matches the supplied project (${expected.projectRoot}) using ${processProject.source ?? 'unknown'} directory evidence at ${processProject.confidence} confidence.`,
        ]
      : [];
  const differentEvidence =
    processProject.status === 'identified' && processProject.projectRoot !== expected.projectRoot
      ? [`Git project root differs: observed ${processProject.projectRoot}; expected ${expected.projectRoot}.`]
      : [];
  if (processProject.status === 'ambiguous')
    return assessment(
      'ambiguous',
      pid,
      startTime,
      true,
      expected.projectRoot,
      sessionId ?? null,
      processProject,
      agentAttribution,
      matchingEvidence,
      differentEvidence,
      observedAt,
      pidNamespace,
    );
  if (processProject.status !== 'identified')
    return assessment(
      'unknown',
      pid,
      startTime,
      true,
      expected.projectRoot,
      sessionId ?? null,
      processProject,
      agentAttribution,
      matchingEvidence,
      differentEvidence,
      observedAt,
      pidNamespace,
    );
  if (differentEvidence.length)
    return assessment(
      'different',
      pid,
      startTime,
      true,
      expected.projectRoot,
      sessionId ?? null,
      processProject,
      agentAttribution,
      matchingEvidence,
      differentEvidence,
      observedAt,
      pidNamespace,
    );
  if (sessionId !== undefined) {
    if (agentAttribution.status === 'ambiguous')
      return assessment(
        'ambiguous',
        pid,
        startTime,
        true,
        expected.projectRoot,
        sessionId,
        processProject,
        agentAttribution,
        matchingEvidence,
        differentEvidence,
        observedAt,
        pidNamespace,
      );
    if (agentAttribution.status !== 'associated' || agentAttribution.sessionId === null)
      return assessment(
        'unknown',
        pid,
        startTime,
        true,
        expected.projectRoot,
        sessionId,
        processProject,
        agentAttribution,
        matchingEvidence,
        differentEvidence,
        observedAt,
        pidNamespace,
      );
    if (agentAttribution.sessionId !== sessionId)
      differentEvidence.push(
        `Agent session ID differs: observed ${agentAttribution.sessionId}; expected ${sessionId}.`,
      );
    else matchingEvidence.push(`Opt-in agent session ID matches (${sessionId}).`);
  }
  return assessment(
    differentEvidence.length ? 'different' : 'matching',
    pid,
    startTime,
    true,
    expected.projectRoot,
    sessionId ?? null,
    processProject,
    agentAttribution,
    matchingEvidence,
    differentEvidence,
    observedAt,
    pidNamespace,
  );
}

export function formatProcessAssessment(result: ProcessOwnershipAssessment): string {
  const lines = [`Process ownership assessment: ${result.status.toUpperCase()}`, result.message];
  lines.push(
    `PID ${result.pid}; start-time token: ${result.identity.startTime ?? 'unavailable'}; stable identity observed: ${result.identity.stable ? 'yes' : 'no'}.`,
  );
  lines.push(`Expected project: ${result.expectedProject}`);
  if (result.expectedSessionId) lines.push(`Expected session: ${result.expectedSessionId}`);
  if (result.processProject?.projectRoot) lines.push(`Observed project: ${result.processProject.projectRoot}`);
  if (result.agentAttribution)
    lines.push(
      `Agent attribution: ${result.agentAttribution.status}${result.agentAttribution.sessionId ? ` (${result.agentAttribution.sessionId})` : ''}`,
    );
  if (result.matchingEvidence.length)
    lines.push('Matching evidence:', ...result.matchingEvidence.map((item) => `- ${item}`));
  if (result.differentEvidence.length)
    lines.push('Different or uncertain evidence:', ...result.differentEvidence.map((item) => `- ${item}`));
  if (!result.matchingEvidence.length && !result.differentEvidence.length)
    lines.push(formatEmpty('No ownership evidence could be established.'));
  lines.push(`PID namespace: ${result.pidNamespace ?? 'unknown'}.`, `Observed at: ${result.observedAt} (UTC).`);
  lines.push(...result.limitations.map((limitation) => `- ${limitation}`));
  return lines.join('\n');
}

export function registerProcessAssessmentCommand(program: Command): void {
  program
    .command('assess <pid>')
    .description('Compare visible process ownership evidence with a project/session (Linux, read-only)')
    .requiredOption('--project <path>', 'Expected Git project directory')
    .option('--session <session-id>', 'Expected opt-in PORTCN_AGENT_SESSION_ID value')
    .option('--json', 'Print versioned JSON')
    .option('--json-version <version>', 'Print versioned JSON (supported: 1)')
    .action((value: string, options: { project: string; session?: string; json?: boolean; jsonVersion?: string }) => {
      try {
        if (!jsonSchemaIsSupported(options.jsonVersion)) throw new UnsupportedJsonVersionError();
        if (!/^\d+$/.test(value)) throw new InvalidProcessAssessmentInputError('PID must be a positive integer.');
        const result = assessProcessOwnership(Number(value), options.project, options.session);
        process.stdout.write(
          `${options.json || options.jsonVersion ? JSON.stringify(result) : formatProcessAssessment(result)}\n`,
        );
      } catch (error) {
        const json = options.json || options.jsonVersion !== undefined;
        if (json) process.stdout.write(`${JSON.stringify(versionedJsonError(error))}\n`);
        else process.stderr.write(`portcn: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode =
          error instanceof InvalidProcessAssessmentInputError || error instanceof UnsupportedJsonVersionError ? 2 : 1;
      }
    });
}
