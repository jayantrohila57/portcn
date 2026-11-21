/** A TCP/UDP port number that can be represented in an IP socket address. */
export type PortNumber = number & { readonly __portNumber: unique symbol };

/** Checks the numeric range used by IP port fields without probing the host. */
export function isValidPortNumber(value: unknown): value is PortNumber {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535;
}
