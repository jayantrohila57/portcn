import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

export interface EndpointServiceIdentity {
  protocol: 'tcp' | 'udp';
  address: string;
  port: number;
}

export type EndpointCandidate =
  | { status: 'configured' | 'unverified'; url: string }
  | { status: 'non-web'; url: null; reason: string };

function bareAddress(address: string): string {
  return address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function isLoopback(host: string): boolean {
  const address = bareAddress(host);
  const family = isIP(address);
  if (family === 4) return Number(address.split('.')[0]) === 127;
  if (family === 6) {
    try {
      return new URL(`http://[${address}]/`).hostname.toLowerCase() === '[::1]';
    } catch {
      return false;
    }
  }
  return host.toLowerCase() === 'localhost';
}

function hostFromAddress(address: string): string | null {
  const value = bareAddress(address);
  if (value === '*') return 'localhost';
  if (value === '0.0.0.0') return '127.0.0.1';
  if (value === '::') return '::1';
  if (isIP(value) || value.toLowerCase() === 'localhost') return value;
  return null;
}

function canonicalIp(address: string): string {
  const value = bareAddress(address).toLowerCase();
  if (isIP(value) !== 6) return value;
  try {
    return new URL(`http://[${value}]/`).hostname.toLowerCase();
  } catch {
    return value;
  }
}

function isLocalInterfaceAddress(host: string): boolean {
  if (!isIP(host) || host.includes('%')) return false;
  const target = canonicalIp(host);
  return Object.values(networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .some((entry) => entry && canonicalIp(entry.address) === target);
}

export function validateServiceUrl(value: string, service: EndpointServiceIdentity): string {
  if (value.length > 2048 || hasControlCharacters(value))
    throw new Error('URL must be at most 2048 characters and cannot contain control characters.');
  if (service.protocol !== 'tcp') throw new Error('HTTP(S) URLs can only be assigned to TCP services.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL must be an absolute local HTTP(S) URL with an explicit matching port.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
    throw new Error('URL must use HTTP(S) and cannot include credentials.');
  const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1] ?? '';
  const portMatch = authority.startsWith('[') ? /^\[[^\]]+\]:(\d+)$/.exec(authority) : /^[^:]+:(\d+)$/.exec(authority);
  const port = Number(portMatch?.[1]);
  if (!portMatch || !Number.isInteger(port) || port < 1 || port > 65_535 || port !== service.port)
    throw new Error(`URL must include the saved service port ${service.port}.`);

  const host = bareAddress(url.hostname.toLowerCase());
  const boundAddress = bareAddress(service.address.toLowerCase());
  const wildcard = boundAddress === '*' || boundAddress === '0.0.0.0' || boundAddress === '::';
  const matchesBoundAddress = !wildcard && isIP(boundAddress) !== 0 && canonicalIp(host) === canonicalIp(boundAddress);
  if (!isLoopback(host) && !matchesBoundAddress)
    throw new Error('URL host must be localhost, a loopback address, or the service bind address.');

  // URL normalizes default ports away. Keep the explicit service port so persisted
  // values can be validated consistently and the endpoint remains unambiguous.
  const bracketedHost = isIP(host) === 6 ? `[${host}]` : host;
  return `${url.protocol}//${bracketedHost}:${port}${url.pathname}${url.search}${url.hash}`;
}

export function endpointCandidate(service: EndpointServiceIdentity & { url?: string | null }): EndpointCandidate {
  if (service.url) {
    const url = validateServiceUrl(service.url, service);
    const host = bareAddress(new URL(url).hostname.toLowerCase());
    if (!isLoopback(host) && !isLocalInterfaceAddress(host))
      return { status: 'non-web', url: null, reason: 'The URL host is not a local interface on this host.' };
    return { status: 'configured', url };
  }
  if (service.protocol !== 'tcp') return { status: 'non-web', url: null, reason: 'UDP services do not use HTTP(S).' };
  const host = hostFromAddress(service.address);
  if (!host) return { status: 'non-web', url: null, reason: 'No eligible local address is available.' };
  if (!isLoopback(host) && !isLocalInterfaceAddress(host))
    return { status: 'non-web', url: null, reason: 'The bind address is not a local interface on this host.' };
  const bracketedHost = isIP(host) === 6 ? `[${host}]` : host;
  const url = `http://${bracketedHost}:${service.port}/`;
  return { status: 'unverified', url: validateServiceUrl(url, service) };
}
