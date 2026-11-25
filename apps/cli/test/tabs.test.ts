import { describe, expect, it, vi } from 'vitest';
import { formatListeningPorts, type ListeningPort } from '../src/commands/list.js';
import {
  calculatePageSize,
  clampSelection,
  filterPorts,
  formatTabView,
  pageCountFor,
  pageForKey,
  paletteActionForKey,
  runTabbedList,
  searchPorts,
  selectionForKey,
  sortPorts,
  stableColumnWidths,
  tabForKey,
  visibleColumnsForWidth,
} from '../src/commands/tabs.js';
import { displayWidth, sanitizeTerminalText } from '../src/terminal.js';

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
    expect(selectionForKey('j', 0, 2)).toBe(1);
    expect(selectionForKey('k', 0, 2)).toBe(1);
    expect(paletteActionForKey('r')).toBe('refresh');
    expect(paletteActionForKey('a')).toBe('auto-refresh');
  });

  it('searches and sorts without mutating discovery results', () => {
    expect(searchPorts(ports, '5353')[0]?.port).toBe(5353);
    expect(sortPorts([...ports].reverse(), 'protocol').map((port) => port.protocol)).toEqual(['tcp', 'udp']);
    expect(formatTabView(ports, 'all', 0, 24, 'node')).toContain('3000');
    expect(formatTabView(ports, 'all', 0, 24, 'node')).not.toContain('5353');
  });

  it('renders palette and selected process details without changing table geometry', () => {
    expect(formatTabView(ports, 'all', 0, 24, '', 'port', 0, ports[0], true)).toContain('Command palette');
    expect(formatTabView(ports, 'all', 0, 24, '', 'port', 0, ports[0])).toContain('Detail: node | PID 10');
  });

  it('keeps hostile and narrow-terminal content bounded', () => {
    expect(sanitizeTerminalText('node\u001b[31m')).not.toContain('\u001b');
    expect(displayWidth('界')).toBe(2);
    expect(visibleColumnsForWidth(50)).toEqual([0, 1, 2]);
    expect(visibleColumnsForWidth(70)).toEqual([0, 1, 2, 3, 4]);
    expect(visibleColumnsForWidth(100)).toHaveLength(6);
    const narrow = formatTabView([{ ...ports[0], address: '界'.repeat(40), processName: 'node\u001b[31m' }], 'all');
    expect(Math.max(...narrow.split('\n').map((line) => line.length))).toBeLessThanOrEqual(100);
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

  it('clamps selection and calculates pages from the active result set', () => {
    expect(clampSelection(4, 0)).toBe(0);
    expect(clampSelection(4, 3)).toBe(2);
    expect(pageCountFor(0, 5)).toBe(1);
    expect(pageCountFor(11, 5)).toBe(3);
    expect(formatTabView(ports, 'all', 0, 24, 'not-found', 'port', 50)).toContain('Page 1/1  |  0 records');
  });

  it('highlights the selected row with a stable row index', () => {
    const rendered = formatListeningPorts(ports, { color: true, selectedRow: 1 });
    expect(rendered).toContain('\u001b[33m');
    const rows = rendered.split('\n').filter((line) => line.includes('\u001b[33m'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('5353');
    expect(rows[0]).not.toContain('3000');
  });

  it('restores terminal state when the first render fails', async () => {
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    const stdout = process.stdout;
    const originalInputTty = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
    const originalOutputTty = Object.getOwnPropertyDescriptor(stdout, 'isTTY');
    const originalRawMode = Object.getOwnPropertyDescriptor(stdin, 'setRawMode');
    const inputListeners = stdin.listenerCount('data');
    const resizeListeners = stdout.listenerCount('resize');
    const signalListeners = process.listenerCount('SIGINT');
    const setRawMode = vi.fn();
    Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(stdout, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(stdin, 'setRawMode', { configurable: true, value: setRawMode });
    const write = vi.spyOn(stdout, 'write').mockImplementation(() => {
      throw new Error('simulated terminal write failure');
    });

    try {
      await expect(runTabbedList(ports)).rejects.toThrow('simulated terminal write failure');
      expect(setRawMode).toHaveBeenNthCalledWith(1, true);
      expect(setRawMode).toHaveBeenNthCalledWith(2, false);
      expect(stdin.listenerCount('data')).toBe(inputListeners);
      expect(stdout.listenerCount('resize')).toBe(resizeListeners);
      expect(process.listenerCount('SIGINT')).toBe(signalListeners);
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      write.mockRestore();
      if (originalInputTty) Object.defineProperty(stdin, 'isTTY', originalInputTty);
      else Reflect.deleteProperty(stdin, 'isTTY');
      if (originalOutputTty) Object.defineProperty(stdout, 'isTTY', originalOutputTty);
      else Reflect.deleteProperty(stdout, 'isTTY');
      if (originalRawMode) Object.defineProperty(stdin, 'setRawMode', originalRawMode);
      else Reflect.deleteProperty(stdin, 'setRawMode');
    }
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
