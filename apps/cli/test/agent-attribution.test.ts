import { describe, expect, it } from 'vitest';
import { inspectAgentAttribution } from '../src/commands/agent-attribution.js';

const ancestors = [{ pid: 10, name: 'shell', cwd: '/repo', executable: '/usr/bin/bash' }];

function procEnvironments(values: Record<number, string>, options: { reused?: boolean; denied?: number } = {}) {
  const reads = new Map<number, number>();
  return {
    readFile: (path: string) => {
      const stat = /^\/proc\/(\d+)\/stat$/.exec(path);
      if (stat) {
        const pid = Number(stat[1]);
        const count = (reads.get(pid) ?? 0) + 1;
        reads.set(pid, count);
        const fields = Array.from({ length: 19 }, () => '0');
        fields[0] = '1';
        fields[18] = String(options.reused && pid === 42 && count > 1 ? 999 : 123);
        return `${pid} (fixture) S ${fields.join(' ')}`;
      }
      const environment = /^\/proc\/(\d+)\/environ$/.exec(path);
      if (environment) {
        const pid = Number(environment[1]);
        if (options.denied === pid) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return values[pid] ?? '';
      }
      throw new Error(`Unexpected read: ${path}`);
    },
  };
}

describe('opt-in agent attribution', () => {
  it('associates an owner with an explicit session and reports a possible leftover without asserting safety', () => {
    const result = inspectAgentAttribution(42, ancestors, {
      ...procEnvironments({ 42: 'PORTCN_AGENT_SESSION_ID=session-7\0PORTCN_AGENT_NAME=codex\0' }),
      now: () => new Date('2026-11-25T00:00:00.000Z'),
    });
    expect(result).toMatchObject({
      status: 'associated',
      confidence: 'high',
      agentName: 'codex',
      sessionId: 'session-7',
      sourcePid: 42,
      source: 'owner',
      leftoverAssessment: 'possible',
      observedAt: '2026-11-25T00:00:00.000Z',
    });
    expect(result.evidence.join(' ')).toContain('not confirmed');
    expect(
      inspectAgentAttribution(42, [], {
        ...procEnvironments({ 42: 'PORTCN_AGENT_SESSION_ID=session-7\0' }),
      }),
    ).toMatchObject({ status: 'associated', source: 'owner', leftoverAssessment: 'possible' });
  });

  it('uses ancestor metadata at lower confidence and marks conflicting sessions ambiguous', () => {
    expect(
      inspectAgentAttribution(42, ancestors, {
        ...procEnvironments({ 10: 'PORTCN_AGENT_SESSION_ID=session-7\0PORTCN_AGENT_NAME=codex\0' }),
      }),
    ).toMatchObject({
      status: 'associated',
      confidence: 'medium',
      source: 'ancestor',
      leftoverAssessment: 'not-observed',
    });

    expect(
      inspectAgentAttribution(42, ancestors, {
        ...procEnvironments({
          42: 'PORTCN_AGENT_SESSION_ID=session-7\0',
          10: 'PORTCN_AGENT_SESSION_ID=session-8\0',
        }),
      }),
    ).toMatchObject({ status: 'ambiguous', confidence: 'low', sessionId: null, leftoverAssessment: 'unknown' });
  });

  it('returns unknown when metadata is absent, inaccessible, or the PID changes during inspection', () => {
    expect(inspectAgentAttribution(42, ancestors, { ...procEnvironments({}) }).status).toBe('unknown');
    expect(inspectAgentAttribution(42, ancestors, { ...procEnvironments({}, { denied: 42 }) }).status).toBe('unknown');
    expect(inspectAgentAttribution(42, ancestors, { ...procEnvironments({}, { reused: true }) }).status).toBe(
      'unknown',
    );
    expect(
      inspectAgentAttribution(42, ancestors, {
        ...procEnvironments({ 42: 'PORTCN_AGENT_SESSION_ID=session-7\0' }, { denied: 10 }),
      }),
    ).toMatchObject({ status: 'associated', leftoverAssessment: 'unknown' });
  });
});
