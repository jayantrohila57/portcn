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

export type PortSort = 'port' | 'protocol' | 'process';

export function searchPorts(ports: ListeningPort[], query: string): ListeningPort[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return ports;
  return ports.filter((port) =>
    [port.protocol, port.state, port.address, String(port.port), String(port.pid ?? ''), port.processName ?? '']
      .join(' ')
      .toLowerCase()
      .includes(normalized),
  );
}

export function sortPorts(ports: ListeningPort[], sort: PortSort): ListeningPort[] {
  return [...ports].sort((left, right) => {
    if (sort === 'protocol') return left.protocol.localeCompare(right.protocol) || left.port - right.port;
    if (sort === 'process')
      return (left.processName ?? '').localeCompare(right.processName ?? '') || left.port - right.port;
    return left.port - right.port || left.protocol.localeCompare(right.protocol);
  });
}

export function selectionForKey(key: string, selected: number, length: number): number {
  if (length === 0) return 0;
  if (key === '\u001b[A' || key === 'k') return (selected - 1 + length) % length;
  if (key === '\u001b[B' || key === 'j') return (selected + 1) % length;
  return Math.min(Math.max(selected, 0), length - 1);
}

export function pageForKey(key: string): 'next' | 'previous' | null {
  if (key === 'n' || key === 'N' || key === ' ') return 'next';
  if (key === 'p' || key === 'P') return 'previous';
  return null;
}

export type PaletteAction = 'refresh' | 'auto-refresh' | 'close';

export function paletteActionForKey(key: string): PaletteAction | null {
  if (key === 'r') return 'refresh';
  if (key === 'a') return 'auto-refresh';
  if (key === ':' || key === '\u001b' || key === 'q') return 'close';
  return null;
}

export function selectedPort(
  ports: ListeningPort[],
  tab: PortTab,
  query: string,
  sort: PortSort,
  selected: number,
): ListeningPort | null {
  return sortPorts(searchPorts(filterPorts(ports, tab), query), sort)[selected] ?? null;
}

/** Calculate the number of data rows after the rendered chrome and table frame. */
export function calculatePageSize(terminalHeight: number, chromeLines = 8, tableFrameLines = 4): number {
  return Math.max(1, terminalHeight - chromeLines - tableFrameLines);
}

export function visibleColumnsForWidth(terminalWidth: number): number[] {
  if (terminalWidth < 58) return [0, 1, 2];
  if (terminalWidth < 78) return [0, 1, 2, 3, 4];
  return [0, 1, 2, 3, 4, 5];
}

export function formatTabView(
  ports: ListeningPort[],
  tab: PortTab,
  page = 0,
  terminalHeight = process.stdout.rows ?? 24,
  query = '',
  sort: PortSort = 'port',
  selected = 0,
  detail: ListeningPort | null = null,
  palette = false,
): string {
  const labels: Record<PortTab, string> = { all: 'ALL', tcp: 'TCP', udp: 'UDP', process: 'WITH PROCESS' };
  const width = Math.max(40, process.stdout.columns ?? 100);
  const divider = `+${'-'.repeat(Math.max(1, width - 2))}+`;
  const framed = (text: string) => `| ${text.slice(0, Math.max(0, width - 4)).padEnd(Math.max(0, width - 4))} |`;
  const tabs = PORT_TABS.map(
    (name, index) => `${name === tab ? '[' : ' '} ${index + 1}:${labels[name]} ${name === tab ? ']' : ' '}`,
  ).join('  ');
  const filtered = sortPorts(searchPorts(filterPorts(ports, tab), query), sort);
  const pageSize = calculatePageSize(terminalHeight);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(page, 0), pageCount - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const table = formatListeningPorts(visible, {
    columnWidths: stableColumnWidths(ports, width),
    selectedRow: Math.max(0, selected - currentPage * pageSize),
    visibleColumns: visibleColumnsForWidth(width),
  });
  const detailLine = detail
    ? `Detail: ${detail.processName ?? 'unknown process'} | PID ${detail.pid ?? 'unavailable'} | ${detail.protocol.toUpperCase()} ${detail.address}:${detail.port}`
    : '';
  const paletteLine = palette ? 'Command palette: [r] refresh  [a] auto-refresh  [q/Esc] close' : '';
  return [
    divider,
    framed('PORTCN  LISTENING PORTS'),
    divider,
    framed(`Tabs: ${tabs}`),
    divider,
    table,
    divider,
    ...(detailLine ? [framed(detailLine), divider] : []),
    ...(paletteLine ? [framed(paletteLine), divider] : []),
    framed(
      `Page ${currentPage + 1}/${pageCount}  |  ${filtered.length} records  |  / search  |  s sort:${sort}  |  j/k select  |  n/p page  |  q quit`,
    ),
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

export async function runTabbedList(ports: ListeningPort[], refresh?: () => ListeningPort[]): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`${formatListeningPorts(ports)}\n`);
    return;
  }

  let currentPorts = ports;
  let current: PortTab = 'all';
  let page = 0;
  let query = '';
  let sort: PortSort = 'port';
  let selected = 0;
  let searching = false;
  let palette = false;
  let detail: ListeningPort | null = null;
  let autoRefresh = false;
  let refreshTimer: NodeJS.Timeout | undefined;
  const render = () =>
    process.stdout.write(
      `\u001b[2J\u001b[3J\u001b[H\u001b[?25l${formatTabView(currentPorts, current, page, process.stdout.rows ?? 24, query, sort, selected, detail, palette)}\n`,
    );
  const stdin = process.stdin;
  const onResize = () => render();
  stdin.setRawMode?.(true);
  stdin.resume();
  process.stdout.on('resize', onResize);
  render();
  await new Promise<void>((resolve) => {
    const onKey = (chunk: Buffer) => {
      const key = chunk.toString();
      if (palette) {
        const action = paletteActionForKey(key);
        if (action === 'close') palette = false;
        if (action === 'refresh' && refresh) {
          try {
            currentPorts = refresh();
            selected = 0;
            page = 0;
            detail = null;
          } catch {
            detail = null;
          }
          palette = false;
        }
        if (action === 'auto-refresh' && refresh) {
          autoRefresh = !autoRefresh;
          if (autoRefresh)
            refreshTimer = setInterval(() => {
              try {
                currentPorts = refresh();
                render();
              } catch {
                /* retain last good snapshot */
              }
            }, 5_000);
          else if (refreshTimer) clearInterval(refreshTimer);
          palette = false;
        }
        render();
        return;
      }
      if (searching) {
        if (key === '\r') searching = false;
        else if (key === '\u001b') {
          searching = false;
          query = '';
        } else if (key === '\u007f') query = query.slice(0, -1);
        else if (key.length === 1 && key >= ' ') query += key;
        selected = 0;
        page = 0;
        render();
        return;
      }
      if (key === '/') {
        searching = true;
        render();
        return;
      }
      if (key === ':') {
        palette = true;
        render();
        return;
      }
      if (key === '\r') {
        detail = selectedPort(currentPorts, current, query, sort, selected);
        render();
        return;
      }
      if (key === 's' || key === 'S') {
        sort = sort === 'port' ? 'protocol' : sort === 'protocol' ? 'process' : 'port';
        selected = 0;
        page = 0;
        render();
        return;
      }
      const nextSelection = selectionForKey(
        key,
        selected,
        searchPorts(filterPorts(currentPorts, current), query).length,
      );
      if (nextSelection !== selected || key === 'j' || key === 'k' || key === '\u001b[A' || key === '\u001b[B') {
        selected = nextSelection;
        page = Math.floor(selected / calculatePageSize(process.stdout.rows ?? 24));
        render();
        return;
      }
      const next = tabForKey(key, current);
      if (next === 'quit') {
        stdin.off('data', onKey);
        process.stdout.off('resize', onResize);
        stdin.setRawMode?.(false);
        stdin.pause();
        process.stdout.write('\u001b[?25h\n');
        resolve();
      } else if (next) {
        current = next;
        page = 0;
        render();
      } else {
        const pageAction = pageForKey(key);
        if (pageAction) {
          const pageSize = calculatePageSize(process.stdout.rows ?? 24);
          const pageCount = Math.max(1, Math.ceil(filterPorts(currentPorts, current).length / pageSize));
          page = pageAction === 'next' ? (page + 1) % pageCount : (page - 1 + pageCount) % pageCount;
          render();
        }
      }
    };
    stdin.on('data', onKey);
  });
  if (refreshTimer) clearInterval(refreshTimer);
}
