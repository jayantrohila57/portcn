export interface TableOptions {
  color?: boolean;
  columnColors?: Record<number, string>;
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

export function formatTable(headers: string[], rows: string[][], options: TableOptions = {}): string {
  const color = options.color ?? Boolean(process.stdout.isTTY);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const formatRow = (values: string[], header = false) =>
    `| ${values
      .map((value, index) => {
        const padded = value.padEnd(widths[index] ?? 0);
        if (header) return paint(padded, ansi.cyan + ansi.bold, color);
        return options.columnColors?.[index] ? paint(padded, options.columnColors[index], color) : padded;
      })
      .join(' | ')} |`;
  return [border, formatRow(headers, true), border, ...rows.map((row) => formatRow(row)), border].join('\n');
}

export function formatEmpty(message: string, options: TableOptions = {}): string {
  const color = options.color ?? Boolean(process.stdout.isTTY);
  return paint(message, ansi.yellow, color);
}
