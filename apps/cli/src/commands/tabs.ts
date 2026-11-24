import type { ListeningPort } from './list.js';
import { formatListeningPorts } from './list.js';

export const PORT_TABS = ['all', 'tcp', 'udp', 'process'] as const;
export type PortTab = (typeof PORT_TABS)[number];

export function tabForKey(key: string, current: PortTab = 'all'): PortTab | 'quit' | null {
  if (key === 'q' || key === 'Q' || key === '\u001b') return 'quit';
  if (key === '1') return 'all';
  if (key === '2') return 'tcp';
  if (key === '3') return 'udp';
  if (key === '4') return 'process';
  if (key === '\t') return PORT_TABS[(PORT_TABS.indexOf(current) + 1) % PORT_TABS.length] ?? 'all';
  return null;
}

export function filterPorts(ports: ListeningPort[], tab: PortTab): ListeningPort[] {
  if (tab === 'all') return ports;
  if (tab === 'process') return ports.filter((port) => port.pid !== null);
  return ports.filter((port) => port.protocol === tab);
}

export function formatTabView(ports: ListeningPort[], tab: PortTab): string {
  const labels: Record<PortTab, string> = { all: 'ALL', tcp: 'TCP', udp: 'UDP', process: 'WITH PROCESS' };
  const width = process.stdout.columns ?? 100;
  const divider = `+${'-'.repeat(Math.max(1, width - 2))}+`;
  const framed = (text: string) => `| ${text.slice(0, Math.max(0, width - 4)).padEnd(Math.max(0, width - 4))} |`;
  const tabs = PORT_TABS.map(
    (name, index) => `${name === tab ? '[' : ' '} ${index + 1}:${labels[name]} ${name === tab ? ']' : ' '}`,
  ).join('  ');
  const table = formatListeningPorts(filterPorts(ports, tab), { columnWidths: stableColumnWidths(ports, width) });
  return [
    divider,
    framed('PORTCN  LISTENING PORTS'),
    divider,
    framed(`Tabs: ${tabs}`),
    divider,
    table,
    divider,
    framed('Navigation: 1-4 switch tabs  |  Tab next tab  |  q or Esc quit'),
    divider,
  ].join('\n');
}

export function stableColumnWidths(ports: ListeningPort[], terminalWidth = process.stdout.columns ?? 100): number[] {
  const rows = ports.map((port) => [
    port.protocol.toUpperCase(),
    port.state,
    String(port.port),
    port.address,
    port.pid === null ? '-' : String(port.pid),
    port.processName ?? '-',
  ]);
  const headers = ['PROTO', 'STATE', 'PORT', 'LOCAL ADDRESS', 'PID', 'PROCESS'];
  const natural = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const widths = natural.map((width, index) =>
    index === 3 ? Math.min(width, 24) : index === 5 ? Math.min(width, 24) : width,
  );
  const minimum = [5, 6, 4, 12, 3, 8];
  const minimumUsed = minimum.reduce((sum, width) => sum + width, 0) + widths.length * 3 + 1;
  if (minimumUsed > terminalWidth) return minimum;
  for (let index = 0; index < widths.length; index += 1) {
    widths[index] = Math.max(widths[index] ?? 0, minimum[index] ?? 0);
  }
  let used = widths.reduce((sum, width) => sum + width, 0) + widths.length * 3 + 1;
  for (const index of [3, 5]) {
    while (used > terminalWidth && (widths[index] ?? 0) > (minimum[index] ?? 0)) {
      widths[index] -= 1;
      used -= 1;
    }
  }
  const extra = Math.max(0, terminalWidth - used);
  widths[widths.length - 1] = (widths[widths.length - 1] ?? 0) + extra;
  return widths;
}

export async function runTabbedList(ports: ListeningPort[]): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`${formatListeningPorts(ports)}\n`);
    return;
  }

  let current: PortTab = 'all';
  const render = () => process.stdout.write('\u001b[2J\u001b[H' + formatTabView(ports, current) + '\n');
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();
  render();
  await new Promise<void>((resolve) => {
    const onKey = (chunk: Buffer) => {
      const next = tabForKey(chunk.toString(), current);
      if (next === 'quit') {
        stdin.off('data', onKey);
        stdin.setRawMode?.(false);
        stdin.pause();
        process.stdout.write('\n');
        resolve();
      } else if (next) {
        current = next;
        render();
      }
    };
    stdin.on('data', onKey);
  });
}
