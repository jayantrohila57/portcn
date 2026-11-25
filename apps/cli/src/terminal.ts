export interface TableOptions {
  color?: boolean;
  columnColors?: Record<number, string>;
  columnWidths?: number[];
  selectedRow?: number;
  visibleColumns?: number[];
}

export const TERMINAL_THEME = {
  normal: '',
  muted: '\u001b[2m',
  selected: '\u001b[7m',
  focused: '\u001b[1;36m',
  success: '\u001b[32m',
  warning: '\u001b[33m',
  error: '\u001b[31m',
  header: '\u001b[1;36m',
  reset: '\u001b[0m',
} as const;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function terminalColorEnabled(
  isTTY = Boolean(process.stdout.isTTY),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTTY && !(env.NO_COLOR !== undefined && env.NO_COLOR !== '') && env.TERM !== 'dumb';
}

function paint(value: string, color: string, enabled: boolean): string {
  return enabled && color ? `${color}${value}${TERMINAL_THEME.reset}` : value;
}

export function displayWidth(value: string): number {
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(value)) {
    if (/\p{Emoji_Presentation}|\u200d|\uFE0F|\u20E3/u.test(segment)) {
      width += 2;
      continue;
    }
    for (const character of segment) {
      const code = character.codePointAt(0) ?? 0;
      if (code === 0x200d || code === 0xfe0e || code === 0xfe0f || /\p{Mark}/u.test(character)) continue;
      width += isWideCodePoint(code) ? 2 : 1;
    }
  }
  return width;
}

function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function truncateTerminalText(value: string, maxWidth: number): string {
  if (displayWidth(value) <= maxWidth) return value;
  if (maxWidth <= 1) return '~';
  let result = '';
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(value)) {
    const segmentWidth = displayWidth(segment);
    if (width + segmentWidth > maxWidth - 1) break;
    result += segment;
    width += segmentWidth;
  }
  return `${result}~`;
}

export function fitTerminalText(value: string, width: number): string {
  const sanitized = sanitizeTerminalText(value);
  const fitted = truncateTerminalText(sanitized, Math.max(0, width));
  return fitted + ' '.repeat(Math.max(0, width - displayWidth(fitted)));
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
  const color = options.color ?? terminalColorEnabled();
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
  const formatRow = (values: string[], rowIndex: number, header = false) =>
    `| ${values
      .map((value, index) => {
        const width = widths[index] ?? displayWidth(value);
        const selected = !header && options.selectedRow === rowIndex;
        const indicated = selected && index === 0 ? `> ${value}` : value;
        const clipped = truncateTerminalText(indicated, width);
        const padded = clipped + ' '.repeat(Math.max(0, width - displayWidth(clipped)));
        if (header) return paint(padded, TERMINAL_THEME.header, color);
        if (selected) return paint(padded, TERMINAL_THEME.selected, color);
        return options.columnColors?.[index] ? paint(padded, options.columnColors[index], color) : padded;
      })
      .join(' | ')} |`;
  return [
    border,
    formatRow(visibleHeaders, -1, true),
    border,
    ...visibleRows.map((row, index) => formatRow(row, index)),
    border,
  ].join('\n');
}

export function formatEmpty(message: string, options: TableOptions = {}): string {
  const color = options.color ?? terminalColorEnabled();
  return paint(message, TERMINAL_THEME.warning, color);
}
