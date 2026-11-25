import { readFileSync } from 'node:fs';
import type { ProcessAncestor } from './project-context.js';

export type AgentAttributionStatus = 'associated' | 'ambiguous' | 'unknown';
export type LeftoverAssessment = 'possible' | 'not-observed' | 'unknown';

export interface AgentAttribution {
  status: AgentAttributionStatus;
  confidence: 'high' | 'medium' | 'low' | 'none';
  agentName: string | null;
  sessionId: string | null;
  sourcePid: number | null;
  source: 'owner' | 'ancestor' | null;
  leftoverAssessment: LeftoverAssessment;
  observedAt: string;
  evidence: string[];
}

export interface AgentAttributionDependencies {
  readFile?: (path: string, encoding: BufferEncoding) => string;
  now?: () => Date;
}

const readFile = (path: string, encoding: BufferEncoding): string => readFileSync(path, encoding);
const safeMarker = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,79}$/;

interface Markers {
  sessionId: string | null;
  agentName: string | null;
}

function startTime(pid: number, read: typeof readFile): string | null {
  try {
    const stat = read(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    return (
      stat
        .slice(close + 1)
        .trim()
        .split(/\s+/)[19] ?? null
    );
  } catch {
    return null;
  }
}

function markersFor(pid: number, read: typeof readFile): Markers | null {
  const before = startTime(pid, read);
  if (!before) return null;
  let entries: string;
  try {
    entries = read(`/proc/${pid}/environ`, 'utf8');
  } catch {
    return null;
  }
  const after = startTime(pid, read);
  if (!after || before !== after) return null;
  const values = new Map<string, string>();
  for (const entry of entries.split('\0')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    const key = entry.slice(0, separator);
    if (key === 'PORTCN_AGENT_SESSION_ID' || key === 'PORTCN_AGENT_NAME') {
      const value = entry.slice(separator + 1);
      if (safeMarker.test(value)) values.set(key, value);
    }
  }
  return {
    sessionId: values.get('PORTCN_AGENT_SESSION_ID') ?? null,
    agentName: values.get('PORTCN_AGENT_NAME') ?? null,
  };
}

export function inspectAgentAttribution(
  pid: number,
  ancestors: ProcessAncestor[],
  dependencies: AgentAttributionDependencies = {},
): AgentAttribution {
  const read = dependencies.readFile ?? readFile;
  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const chain = [
    { pid, source: 'owner' as const },
    ...ancestors.map(({ pid: ancestorPid }) => ({ pid: ancestorPid, source: 'ancestor' as const })),
  ];
  const visible = chain
    .map((entry) => ({ ...entry, markers: markersFor(entry.pid, read) }))
    .filter((entry): entry is typeof entry & { markers: Markers } => entry.markers !== null);
  const ancestryComplete = visible.length === chain.length;
  const marked = visible.filter((entry) => entry.markers.sessionId !== null);
  const sessionIds = [...new Set(marked.map((entry) => entry.markers.sessionId as string))];
  const ambiguous = sessionIds.length > 1;
  const selected = marked[0] ?? null;
  const sameSessionAncestor = selected
    ? marked.some((entry) => entry.source === 'ancestor' && entry.markers.sessionId === selected.markers.sessionId)
    : false;
  const evidence = [
    ...(selected
      ? [`Opt-in session metadata was read from the ${selected.source} process environment (PID ${selected.pid}).`]
      : ['No valid opt-in agent session marker was visible on the owner or inspected ancestors.']),
    ...(ambiguous ? ['Conflicting opt-in session IDs were found in the process ancestry.'] : []),
    ...(selected?.source === 'owner' && !sameSessionAncestor && ancestryComplete
      ? [
          'The owner carries a session marker but no inspected ancestor carries the same marker; a leftover is possible, not confirmed.',
        ]
      : []),
    ...(selected?.source === 'owner' && !sameSessionAncestor && !ancestryComplete
      ? ['The owner carries a session marker, but incomplete ancestry prevents a leftover assessment.']
      : []),
    ...(selected && sameSessionAncestor
      ? [
          'A process in the inspected ancestry carries the same session marker; this does not prove the agent session is active.',
        ]
      : []),
    ...(visible.length < chain.length
      ? ['Some process environments were inaccessible, exited, or changed identity during inspection.']
      : []),
  ];
  return {
    status: ambiguous ? 'ambiguous' : selected ? 'associated' : 'unknown',
    confidence: ambiguous ? 'low' : selected?.source === 'owner' ? 'high' : selected ? 'medium' : 'none',
    agentName: ambiguous ? null : (selected?.markers.agentName ?? null),
    sessionId: ambiguous ? null : (selected?.markers.sessionId ?? null),
    sourcePid: ambiguous ? null : (selected?.pid ?? null),
    source: ambiguous ? null : (selected?.source ?? null),
    leftoverAssessment: ambiguous
      ? 'unknown'
      : selected?.source === 'owner' && !sameSessionAncestor && ancestryComplete
        ? 'possible'
        : selected && (sameSessionAncestor || selected.source === 'ancestor')
          ? 'not-observed'
          : 'unknown',
    observedAt,
    evidence,
  };
}
