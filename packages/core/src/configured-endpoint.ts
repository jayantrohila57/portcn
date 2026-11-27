import { isValidPortNumber, type PortNumber } from './port-number.js';

export interface ConfiguredEndpointRef {
  protocol: 'tcp' | 'udp';
  address: string | null;
  port: PortNumber;
}

function addressToken(address: string | null | undefined): string {
  if (address === null || address === undefined || address === '' || address === '*') return '*';
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  if (bare.includes(':')) return `[${bare}]`;
  return bare;
}

/** Encode a configured listener endpoint for stable evidence source references. */
export function formatConfiguredEndpointRef(
  protocol: 'tcp' | 'udp',
  address: string | null | undefined,
  port: number,
): string {
  if (!isValidPortNumber(port)) throw new Error(`Configured endpoint port is out of range: ${port}`);
  return `configured:${protocol}:${addressToken(address)}:${port}`;
}

/** Parse configured endpoint references, including bracketed IPv6 literals. */
export function parseConfiguredEndpointRef(sourceRef: string): ConfiguredEndpointRef | null {
  const match = /^configured:(tcp|udp):(\*|\[[^\]]+\]|[^:]+):(\d+)$/.exec(sourceRef);
  if (!match) return null;
  const port = Number(match[3]);
  if (!isValidPortNumber(port)) return null;
  const raw = match[2];
  const address = raw === '*' ? null : raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  return { protocol: match[1] as 'tcp' | 'udp', address, port };
}
