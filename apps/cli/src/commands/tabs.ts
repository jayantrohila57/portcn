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
  const tabs = PORT_TABS.map(
    (name, index) => `${name === tab ? '[' : ' '} ${index + 1}:${labels[name]} ${name === tab ? ']' : ' '}`,
  ).join('  ');
  return `${tabs}\nKeys: 1-4 switch tabs · Tab next · q quit\n\n${formatListeningPorts(filterPorts(ports, tab))}`;
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
