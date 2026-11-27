import { describe, expect, it } from 'vitest';
import { formatConfiguredEndpointRef, parseConfiguredEndpointRef } from '../src/configured-endpoint.js';

describe('configured endpoint references', () => {
  it('round-trips IPv4, bracketed IPv6, and wildcard addresses', () => {
    for (const [protocol, address, port] of [
      ['tcp', '127.0.0.1', 8080],
      ['tcp', '[::1]', 8443],
      ['tcp', '::1', 8443],
      ['udp', '*', 53],
    ] as const) {
      const ref = formatConfiguredEndpointRef(protocol, address, port);
      expect(parseConfiguredEndpointRef(ref)).toMatchObject({
        protocol,
        port,
        address: address === '*' ? null : address.replace(/^\[|\]$/g, ''),
      });
    }
  });

  it('rejects legacy ambiguous IPv6 encodings', () => {
    expect(parseConfiguredEndpointRef('configured:tcp:::1:8443')).toBeNull();
  });
});
