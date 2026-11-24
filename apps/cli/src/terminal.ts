export interface TableOptions {
  color?: boolean;
  columnColors?: Record<number, string>;
  columnWidths?: number[];
  selectedRow?: number;
  visibleColumns?: number[];
}

const ansi = {
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  reset: '\u001b[0m',
};

function paint(value: string, color: string, enabled: boolean): string {
  return enabled ? `${color}${value}${ansi.reset}` : value;
}

export function displayWidth(value: string): number {
  return [...value].reduce((width, character) => width + ((character.codePointAt(0) ?? 0) > 0x2ff ? 2 : 1), 0);
}

export function sanitizeTerminalText(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? ' ' : character;
    })
    .join('');
}

export function formatTable(headers: string[], rows: string[][], options: TableOptions = {}): string {
  const columns = options.visibleColumns ?? headers.map((_, index) => index);
  const visibleHeaders = columns.map((index) => sanitizeTerminalText(headers[index] ?? ''));
  const visibleRows = rows.map((row) => columns.map((index) => sanitizeTerminalText(row[index] ?? '')));
  const color = options.color ?? Boolean(process.stdout.isTTY);
  const naturalWidths = visibleHeaders.map((header, index) =>
    Math.max(displayWidth(header), ...visibleRows.map((row) => displayWidth(row[index] ?? ''))),
  );
  const widths = options.columnWidths
    ? visibleHeaders.map((header, index) =>
        Math.max(
          displayWidth(header),
          options.columnWidths?.[columns[index] ?? index] ?? naturalWidths[index] ?? displayWidth(header),
        ),
      )
    : naturalWidths;
  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const formatRow = (values: string[], header = false) =>
    `| ${values
      .map((value, index) => {
        const width = widths[index] ?? displayWidth(value);
        const clipped =
          displayWidth(value) > width ? `${[...value].slice(0, Math.max(1, width - 1)).join('')}~` : value;
        const padded = clipped + ' '.repeat(Math.max(0, width - displayWidth(clipped)));
        if (header) return paint(padded, ansi.cyan + ansi.bold, color);
        if (options.selectedRow === rows.indexOf(values)) return paint(padded, ansi.yellow, color);
        return options.columnColors?.[index] ? paint(padded, options.columnColors[index], color) : padded;
      })
      .join(' | ')} |`;
  return [border, formatRow(visibleHeaders, true), border, ...visibleRows.map((row) => formatRow(row)), border].join(
    '\n',
  );
}

export function formatEmpty(message: string, options: TableOptions = {}): string {
  const color = options.color ?? Boolean(process.stdout.isTTY);
  return paint(message, ansi.yellow, color);
}
