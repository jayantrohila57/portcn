import { describe, expect, it } from 'vitest';
import type { ListeningPort } from '../src/commands/list.js';
import {
  calculatePageSize,
  filterPorts,
  formatTabView,
  pageForKey,
  stableColumnWidths,
  tabForKey,
} from '../src/commands/tabs.js';

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
    expect(pageForKey('n')).toBe('next');
    expect(pageForKey('p')).toBe('previous');
  });

  it('filters unnecessary ports by protocol and process visibility', () => {
    expect(filterPorts(ports, 'tcp')).toHaveLength(1);
    expect(filterPorts(ports, 'udp')).toHaveLength(1);
    expect(filterPorts(ports, 'process')).toHaveLength(1);
    expect(formatTabView(ports, 'tcp')).toContain('PORTCN  LISTENING PORTS');
    expect(formatTabView(ports, 'tcp')).toContain('Page 1/1');
    expect(formatTabView(ports, 'tcp')).toContain('3000');
    expect(formatTabView(ports, 'tcp')).not.toContain('5353');
    expect(formatTabView(ports, 'tcp').endsWith(`+${'-'.repeat(98)}+`)).toBe(true);
  });

  it('paginates rows to the available terminal height', () => {
    const manyPorts = Array.from({ length: 20 }, (_, index) => ({ ...ports[0], port: 3000 + index }));
    expect(calculatePageSize(15)).toBe(3);
    expect(formatTabView(manyPorts, 'all', 0, 15)).toContain('Page 1/7');
    expect(formatTabView(manyPorts, 'all', 6, 15)).toContain('Page 7/7');
    expect(formatTabView(manyPorts, 'all', 0, 15)).toContain('3000');
    expect(formatTabView(manyPorts, 'all', 0, 15)).not.toContain('3005');
  });

  it('keeps column widths stable and fills the requested terminal width', () => {
    const widths = stableColumnWidths(ports, 100);
    expect(formatTabView(ports, 'tcp').split('\n')[0]).toBe(formatTabView(ports, 'udp').split('\n')[0]);
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
