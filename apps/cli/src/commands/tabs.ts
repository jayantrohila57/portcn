import { fitTerminalText, formatTable } from '../terminal.js';
import type { ListeningPort } from './list.js';
import { formatListeningPorts } from './list.js';
import { inspectProjectContext, type ProjectContext, readProcessStartTime } from './project-context.js';
import { type DashboardServiceRecord, searchDashboardServices, sortDashboardServices } from './service-dashboard.js';

export const PORT_TABS = ['all', 'tcp', 'udp', 'process'] as const;
export type PortTab = (typeof PORT_TABS)[number];
export type DashboardTab = PortTab | 'services';

export function tabForKey(key: string, current: DashboardTab = 'all'): DashboardTab | 'quit' | null {
  if (key === 'q' || key === 'Q' || key === '\u001b') return 'quit';
  if (key === '1') return 'all';
  if (key === '2') return 'tcp';
  if (key === '3') return 'udp';
  if (key === '4') return 'process';
  if (key === '5') return 'services';
  if (key === '\t') {
    const tabs: DashboardTab[] = [...PORT_TABS, 'services'];
    return tabs[(tabs.indexOf(current) + 1) % tabs.length] ?? 'all';
  }
  return null;
}

export function formatServiceDashboardView(
  records: DashboardServiceRecord[],
  page: number,
  height: number,
  query: string,
  sort: PortSort,
  selected: number,
  palette: boolean,
  width: number,
): string {
  const frameWidth = Math.max(40, width);
  const framed = (text: string) => `| ${fitTerminalText(text, Math.max(0, frameWidth - 4))} |`;
  const divider = `+${'-'.repeat(Math.max(1, frameWidth - 2))}+`;
  const filtered = sortDashboardServices(searchDashboardServices(records, query), sort);
  const compact = height <= 16;
  const pageSize = dashboardPageSize(height, palette);
  const pageCount = pageCountFor(filtered.length, pageSize);
  const currentPage = Math.min(Math.max(page, 0), pageCount - 1);
  const currentSelection = clampSelection(selected, filtered.length);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const rows = visible.map((record) => [
    record.source.toUpperCase(),
    record.status,
    record.name,
    record.endpoint,
    record.owner,
  ]);
  const headers = ['SOURCE', 'STATUS', 'SERVICE', 'ENDPOINT', 'OWNER'];
  const visibleColumns = frameWidth < 58 ? [0, 1, 2] : frameWidth < 78 ? [0, 1, 2, 3] : [0, 1, 2, 3, 4];
  const minimumWidths = [6, 8, 10, 12, 8];
  const caps = [10, 18, 28, 40, 18];
  const naturalWidths = headers.map((header, index) =>
    Math.min(
      caps[index] ?? 12,
      Math.max(
        header.length,
        ...filtered.map(
          (record) =>
            [record.source.toUpperCase(), record.status, record.name, record.endpoint, record.owner][index]?.length ??
            0,
        ),
      ),
    ),
  );
  const columnWidths = naturalWidths.map((value, index) => Math.max(minimumWidths[index] ?? 8, value));
  const tableWidth = frameWidth - 4;
  const separatorWidth = visibleColumns.length * 3 + 1;
  let occupied = visibleColumns.reduce((sum, index) => sum + (columnWidths[index] ?? 0), 0) + separatorWidth;
  for (const index of [3, 2, 1, 4, 0]) {
    while (occupied > tableWidth && (columnWidths[index] ?? 0) > (minimumWidths[index] ?? 1)) {
      columnWidths[index] -= 1;
      occupied -= 1;
    }
  }
  const table = formatTable(headers, rows, {
    columnWidths,
    selectedRow: currentSelection - currentPage * pageSize,
    visibleColumns,
  });
  const active = filtered[currentSelection];
  const detailLines = active
    ? [
        `Source/status: ${active.source} / ${active.status}`,
        `Service: ${active.name}`,
        `Endpoint: ${active.endpoint}`,
        `Owner: ${active.owner} | Project/scope: ${active.project}`,
        ...active.evidence.slice(0, 2).map((item) => `Evidence: ${item}`),
      ]
    : ['No service records are available.', 'Provider access may be missing or restricted.'];
  const paletteLine = palette ? 'Command palette: [r] refresh  [a] auto-refresh  [q/Esc] close' : '';
  return [
    ...(compact ? [] : [divider]),
    framed('PORTCN  DISCOVERED SERVICES'),
    ...(compact ? [] : [divider]),
    framed('Tabs: 1:ALL  2:TCP  3:UDP  4:WITH PROCESS  [5:SERVICES]'),
    ...(compact ? [] : [divider]),
    table,
    ...(compact ? [] : [divider]),
    ...detailLines.map(framed),
    ...(compact ? [] : [divider]),
    ...(paletteLine ? [framed(paletteLine), ...(compact ? [] : [divider])] : []),
    framed(`Page ${currentPage + 1}/${pageCount} | ${filtered.length} services | / search | j/k move | q quit`),
    ...(compact ? [] : [divider]),
  ].join('\n');
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

export function listenerIdentity(port: ListeningPort): string {
  const owners =
    port.owners
      ?.map(({ pid }) => pid)
      .sort((left, right) => left - right)
      .join(',') ?? String(port.pid ?? 'unknown');
  return `${port.protocol}\0${port.address}\0${port.port}\0${owners}`;
}

export function reconcileSelection(ports: ListeningPort[], identity: string | null, fallback = 0): number {
  if (identity) {
    const matching = ports.findIndex((port) => listenerIdentity(port) === identity);
    if (matching >= 0) return matching;
  }
  return clampSelection(fallback, ports.length);
}

/** Calculate the number of data rows after the rendered chrome and table frame. */
export function calculatePageSize(terminalHeight: number, chromeLines = 8, tableFrameLines = 4): number {
  return Math.max(1, terminalHeight - chromeLines - tableFrameLines);
}

function dashboardPageSize(terminalHeight: number, palette: boolean): number {
  const compact = terminalHeight <= 16;
  return calculatePageSize(terminalHeight, compact ? 7 + Number(palette) : 13 + (palette ? 2 : 0), 4);
}

export function pageCountFor(length: number, pageSize: number): number {
  return Math.max(1, Math.ceil(length / Math.max(1, pageSize)));
}

export function clampSelection(selected: number, length: number): number {
  return length === 0 ? 0 : Math.min(Math.max(selected, 0), length - 1);
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
  selectedService: ListeningPort | null = null,
  palette = false,
  terminalWidth = process.stdout.columns ?? 100,
  projectContext: ProjectContext | null = null,
  servicesAvailable = false,
): string {
  const labels: Record<DashboardTab, string> = {
    all: 'ALL',
    tcp: 'TCP',
    udp: 'UDP',
    process: 'WITH PROCESS',
    services: 'SERVICES',
  };
  const width = Math.max(40, terminalWidth);
  const divider = `+${'-'.repeat(Math.max(1, width - 2))}+`;
  const framed = (text: string) => `| ${fitTerminalText(text, Math.max(0, width - 4))} |`;
  const tabs = [...PORT_TABS, ...(servicesAvailable ? (['services'] as const) : [])]
    .map((name, index) => `${name === tab ? '[' : ' '} ${index + 1}:${labels[name]} ${name === tab ? ']' : ' '}`)
    .join('  ');
  const filtered = sortPorts(searchPorts(filterPorts(ports, tab), query), sort);
  const compact = terminalHeight <= 16;
  const pageSize = dashboardPageSize(terminalHeight, palette);
  const pageCount = pageCountFor(filtered.length, pageSize);
  const currentPage = Math.min(Math.max(page, 0), pageCount - 1);
  const currentSelection = clampSelection(selected, filtered.length);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const table = formatListeningPorts(visible, {
    columnWidths: stableColumnWidths(ports, width),
    selectedRow: currentSelection - currentPage * pageSize,
    visibleColumns: visibleColumnsForWidth(width),
  });
  const activeService = selectedService ?? filtered[currentSelection] ?? null;
  const detailLines = activeService
    ? [
        `Bind: ${activeService.protocol.toUpperCase()} ${activeService.address}:${activeService.port} | ${activeService.state}`,
        `PID: ${activeService.pid ?? 'unavailable'} | Process: ${activeService.processName ?? 'unavailable'}`,
        projectContext ? `Project root: ${projectContext.projectRoot ?? 'unavailable'}` : 'Project root: unavailable',
        projectContext
          ? `Evidence: ${projectContext.status}/${projectContext.confidence} via ${projectContext.source ?? 'no source'}; loaded code unknown`
          : `Evidence: ${activeService.pid === null ? 'owner unavailable' : 'not established'}; loaded code unknown`,
      ]
    : ['No listener is selected.', 'Project evidence unavailable.'];
  const paletteLine = palette ? 'Command palette: [r] refresh  [a] auto-refresh  [q/Esc] close' : '';
  if (compact) {
    return [
      framed('PORTCN  LISTENING PORTS'),
      framed(`Tabs: ${tabs}`),
      table,
      ...detailLines.map(framed),
      ...(paletteLine ? [framed(paletteLine)] : []),
      framed(`Page ${currentPage + 1}/${pageCount} | ${filtered.length} records | / search | j/k move | q quit`),
    ].join('\n');
  }
  return [
    divider,
    framed('PORTCN  LISTENING PORTS'),
    ...(!compact ? [divider] : []),
    framed(`Tabs: ${tabs}`),
    divider,
    table,
    divider,
    ...detailLines.map(framed),
    divider,
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

export async function runTabbedList(
  ports: ListeningPort[],
  refresh?: () => ListeningPort[],
  services: DashboardServiceRecord[] = [],
  refreshServices?: () => DashboardServiceRecord[],
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`${formatListeningPorts(ports)}\n`);
    return;
  }

  let currentPorts = ports;
  let current: DashboardTab = 'all';
  let currentServices = services;
  let page = 0;
  let query = '';
  let sort: PortSort = 'port';
  let selected = 0;
  let searching = false;
  let palette = false;
  let selectedIdentity: string | null = null;
  let projectCache: { identity: string; startTime: string; context: ProjectContext } | null = null;
  let autoRefresh = false;
  let refreshTimer: NodeJS.Timeout | undefined;
  const stdin = process.stdin;
  let settled = false;
  let resolveInteraction: (() => void) | undefined;
  let rejectInteraction: ((error: unknown) => void) | undefined;
  let onKey: (chunk: Buffer) => void = () => {};
  const contextFor = (port: ListeningPort | null): ProjectContext | null => {
    if (!port || port.pid === null) return null;
    const identity = listenerIdentity(port);
    const startTime = readProcessStartTime(port.pid);
    if (startTime && projectCache?.identity === identity && projectCache.startTime === startTime)
      return projectCache.context;
    const context = inspectProjectContext(port.pid, { maxAncestors: 3 });
    const verifiedStartTime = readProcessStartTime(port.pid);
    projectCache = startTime && startTime === verifiedStartTime ? { identity, startTime, context } : null;
    return context;
  };
  const render = () => {
    if (settled) return;
    const filtered =
      current === 'services' ? [] : sortPorts(searchPorts(filterPorts(currentPorts, current), query), sort);
    const filteredServices =
      current === 'services' ? sortDashboardServices(searchDashboardServices(currentServices, query), sort) : [];
    const terminalHeight = process.stdout.rows ?? 24;
    const pageSize = dashboardPageSize(terminalHeight, palette);
    if (selectedIdentity) {
      const found =
        current === 'services'
          ? filteredServices.findIndex((record) => record.identity === selectedIdentity)
          : filtered.findIndex((port) => listenerIdentity(port) === selectedIdentity);
      selected =
        found >= 0 ? found : clampSelection(0, current === 'services' ? filteredServices.length : filtered.length);
    } else selected = clampSelection(selected, current === 'services' ? filteredServices.length : filtered.length);
    selectedIdentity =
      current === 'services'
        ? (filteredServices[selected]?.identity ?? null)
        : filtered[selected]
          ? listenerIdentity(filtered[selected])
          : null;
    page = Math.floor(selected / pageSize);
    const selectedService = current === 'services' ? null : (filtered[selected] ?? null);
    const view =
      current === 'services'
        ? formatServiceDashboardView(
            currentServices,
            page,
            terminalHeight,
            query,
            sort,
            selected,
            palette,
            process.stdout.columns ?? 100,
          )
        : formatTabView(
            currentPorts,
            current,
            page,
            terminalHeight,
            query,
            sort,
            selected,
            selectedService,
            palette,
            process.stdout.columns ?? 100,
            contextFor(selectedService),
            currentServices.length > 0,
          );
    process.stdout.write(`\u001b[2J\u001b[3J\u001b[H\u001b[?25l${view}\n`);
  };
  const onResize = () => {
    try {
      render();
    } catch (error) {
      fail(error);
    }
  };
  const onSignal = () => {
    process.exitCode = 130;
    finish();
  };
  const interaction = new Promise<void>((resolve, reject) => {
    resolveInteraction = resolve;
    rejectInteraction = reject;
  });
  const finish = () => {
    if (settled) return;
    settled = true;
    if (refreshTimer) clearInterval(refreshTimer);
    stdin.off('data', onKey);
    process.stdout.off('resize', onResize);
    process.off('SIGINT', onSignal);
    try {
      if (stdin.isTTY) stdin.setRawMode?.(false);
    } catch {
      // Continue restoring the remaining terminal state if raw-mode teardown fails.
    }
    try {
      stdin.pause();
    } catch {
      // The process must still make a best effort to show the cursor.
    }
    try {
      process.stdout.write('\u001b[?25h\n');
    } catch {
      // There is no further recovery if the output stream itself has failed.
    } finally {
      resolveInteraction?.();
    }
  };
  const fail = (error: unknown) => {
    process.exitCode = 1;
    rejectInteraction?.(error);
    finish();
  };
  onKey = (chunk) => {
    if (settled) return;
    try {
      const key = chunk.toString();
      if (key === '\u0003') {
        process.exitCode = 130;
        finish();
        return;
      }
      if (palette) {
        const action = paletteActionForKey(key);
        if (action === 'close') palette = false;
        if (action === 'refresh' && refresh) {
          try {
            currentPorts = refresh();
            projectCache = null;
          } catch {
            // Keep the last good listener snapshot and its selected context.
          }
          try {
            if (refreshServices) currentServices = refreshServices();
          } catch {
            /* keep last good service snapshot */
          }
          palette = false;
        }
        if (action === 'auto-refresh' && refresh) {
          autoRefresh = !autoRefresh;
          if (autoRefresh)
            refreshTimer = setInterval(() => {
              try {
                currentPorts = refresh();
                projectCache = null;
              } catch {
                return;
              }
              try {
                if (refreshServices) currentServices = refreshServices();
              } catch {
                /* keep last good service snapshot */
              }
              try {
                render();
              } catch (error) {
                fail(error);
              }
            }, 5_000);
          else if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = undefined;
          }
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
        } else if (key === '\u007f') query = [...query].slice(0, -1).join('');
        else if ([...key].length === 1 && key >= ' ') query += key;
        selectedIdentity = null;
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
      if (key === 's' || key === 'S') {
        sort = sort === 'port' ? 'protocol' : sort === 'protocol' ? 'process' : 'port';
        page = 0;
        render();
        return;
      }
      const filtered =
        current === 'services' ? [] : sortPorts(searchPorts(filterPorts(currentPorts, current), query), sort);
      const filteredServices =
        current === 'services' ? sortDashboardServices(searchDashboardServices(currentServices, query), sort) : [];
      const activeLength = current === 'services' ? filteredServices.length : filtered.length;
      selected = clampSelection(selected, activeLength);
      const nextSelection = selectionForKey(key, selected, activeLength);
      if (nextSelection !== selected || key === 'j' || key === 'k' || key === '\u001b[A' || key === '\u001b[B') {
        selected = nextSelection;
        selectedIdentity =
          current === 'services'
            ? (filteredServices[selected]?.identity ?? null)
            : filtered[selected]
              ? listenerIdentity(filtered[selected])
              : null;
        page = Math.floor(selected / dashboardPageSize(process.stdout.rows ?? 24, palette));
        render();
        return;
      }
      const next = tabForKey(key, current);
      if (next === 'quit') {
        finish();
      } else if (next === 'services' && currentServices.length === 0) {
        return;
      } else if (next) {
        current = next;
        page = 0;
        render();
      } else {
        const pageAction = pageForKey(key);
        if (pageAction) {
          const pageSize = dashboardPageSize(process.stdout.rows ?? 24, palette);
          const pageCount = pageCountFor(activeLength, pageSize);
          page = pageAction === 'next' ? (page + 1) % pageCount : (page - 1 + pageCount) % pageCount;
          selected = Math.min(page * pageSize, Math.max(0, activeLength - 1));
          selectedIdentity =
            current === 'services'
              ? (filteredServices[selected]?.identity ?? null)
              : filtered[selected]
                ? listenerIdentity(filtered[selected])
                : null;
          render();
        }
      }
    } catch (error) {
      fail(error);
    }
  };
  try {
    process.stdout.on('resize', onResize);
    stdin.on('data', onKey);
    process.on('SIGINT', onSignal);
    stdin.setRawMode?.(true);
    stdin.resume();
    render();
    await interaction;
  } finally {
    finish();
  }
}
