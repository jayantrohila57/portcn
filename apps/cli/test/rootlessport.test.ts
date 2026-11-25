import { describe, expect, it } from 'vitest';
import { inspectRootlessportProcess, parseRootlessportCommandLine } from '../src/commands/rootlessport.js';

const ARGS = [
  'rootlessport',
  '--proto',
  'tcp',
  '--host-ip',
  '127.0.0.1',
  '--host-port',
  '43117',
  '--container-ip',
  '10.88.0.4',
  '--container-port',
  '8080',
];
const stat = (startTime: string) =>
  `92 (rootlessport) S 0 ${Array.from({ length: 17 }, () => '0').join(' ')} ${startTime}`;

describe('rootlessport evidence inspection', () => {
  it('parses only supported structured forwarding fields', () => {
    expect(parseRootlessportCommandLine(ARGS.join('\0'), '/usr/bin/rootlessport')).toMatchObject({
      status: 'available',
      forwards: [
        {
          protocol: 'tcp',
          hostAddress: '127.0.0.1',
          hostPort: 43117,
          containerAddress: '10.88.0.4',
          containerPort: 8080,
        },
      ],
    });
  });

  it('rejects wrong executables, incomplete mappings, and conflicting flags', () => {
    expect(parseRootlessportCommandLine(ARGS.join('\0'), '/usr/bin/other')).toMatchObject({
      status: 'not-rootlessport',
    });
    expect(parseRootlessportCommandLine('rootlessport\0--host-port=1', '/usr/bin/rootlessport')).toMatchObject({
      status: 'unavailable',
    });
    expect(
      parseRootlessportCommandLine('rootlessport\0--proto=tcp\0--proto=udp', '/usr/bin/rootlessport'),
    ).toMatchObject({ status: 'ambiguous' });
  });

  it('confirms the executable and stable process lifetime', () => {
    const result = inspectRootlessportProcess(92, {
      platform: 'linux',
      readFile: (path) => (path.endsWith('/stat') ? stat('12345') : ARGS.join('\0')),
      readLink: () => '/usr/bin/rootlessport',
    });
    expect(result).toMatchObject({ status: 'available', pid: 92, startTime: '12345', forwards: [{ hostPort: 43117 }] });
  });

  it('discards a PID whose lifetime changes during inspection', () => {
    let reads = 0;
    const result = inspectRootlessportProcess(92, {
      platform: 'linux',
      readFile: (path) => (path.endsWith('/stat') ? stat(++reads === 1 ? '12345' : '12346') : ARGS.join('\0')),
      readLink: () => '/usr/bin/rootlessport',
    });
    expect(result).toMatchObject({ status: 'identity-changed', forwards: [] });
  });

  it('reports unavailable evidence off Linux and when proc access is denied', () => {
    expect(inspectRootlessportProcess(92, { platform: 'darwin' })).toMatchObject({ status: 'unavailable' });
    expect(
      inspectRootlessportProcess(92, {
        platform: 'linux',
        readFile: () => {
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        },
      }),
    ).toMatchObject({ status: 'unavailable' });
  });
});
