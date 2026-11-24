import { describe, expect, it } from 'vitest';
import type { ListeningPort } from '../src/commands/list.js';
import { filterPorts, formatTabView, stableColumnWidths, tabForKey } from '../src/commands/tabs.js';

const ports: ListeningPort[] = [
  { protocol: 'tcp', state: 'LISTEN', address: '127.0.0.1', port: 3000, pid: 10, processName: 'node' },
  { protocol: 'udp', state: 'UNCONN', address: '0.0.0.0', port: 5353, pid: null, processName: null },
];

describe('interactive port tabs', () => {
  it('maps numeric, tab, and quit keys', () => {
    expect(tabForKey('2')).toBe('tcp');
    expect(tabForKey('3')).toBe('udp');
    expect(tabForKey('4')).toBe('process');
    expect(tabForKey('\t', 'tcp')).toBe('udp');
    expect(tabForKey('q')).toBe('quit');
  });

  it('filters unnecessary ports by protocol and process visibility', () => {
    expect(filterPorts(ports, 'tcp')).toHaveLength(1);
    expect(filterPorts(ports, 'udp')).toHaveLength(1);
    expect(filterPorts(ports, 'process')).toHaveLength(1);
    expect(formatTabView(ports, 'tcp')).toContain('Keys: 1-4 switch tabs');
    expect(formatTabView(ports, 'tcp')).toContain('3000');
    expect(formatTabView(ports, 'tcp')).not.toContain('5353');
    expect(formatTabView(ports, 'tcp').endsWith('Keys: 1-4 switch tabs · Tab next · q quit')).toBe(true);
  });

  it('keeps column widths stable and fills the requested terminal width', () => {
    const widths = stableColumnWidths(ports, 100);
    expect(formatTabView(ports, 'tcp').split('\n')[2]).toBe(formatTabView(ports, 'udp').split('\n')[2]);
    expect(widths.reduce((sum, width) => sum + width, 0) + widths.length * 3 + 1).toBe(100);
    const long = [{ ...ports[0], address: '[fe80::1234:5678:90ab:cdef]%very-long-interface' }];
    expect(
      Math.max(
        ...formatTabView(long, 'all')
          .split('\n')
          .map((line) => line.length),
      ),
    ).toBeLessThanOrEqual(100);
  });
});
