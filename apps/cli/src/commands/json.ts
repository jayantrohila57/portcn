export const JSON_SCHEMA_VERSION = 1;

export type JsonErrorCode =
  | 'INVALID_PORT'
  | 'UNSUPPORTED_JSON_VERSION'
  | 'UNSUPPORTED_PLATFORM'
  | 'MISSING_DEPENDENCY'
  | 'DISCOVERY_FAILED';

export interface VersionedJsonError {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  error: {
    code: JsonErrorCode;
    message: string;
    port?: string;
  };
}

export class UnsupportedJsonVersionError extends Error {
  constructor() {
    super('Unsupported JSON version.');
    this.name = 'UnsupportedJsonVersionError';
  }
}

export function versionedJsonError(error: unknown, port?: string): VersionedJsonError {
  const message = error instanceof Error ? error.message : String(error);
  const code: JsonErrorCode =
    error instanceof Error && error.name === 'InvalidPortError'
      ? 'INVALID_PORT'
      : error instanceof UnsupportedJsonVersionError
        ? 'UNSUPPORTED_JSON_VERSION'
        : message.includes('Linux only')
          ? 'UNSUPPORTED_PLATFORM'
          : message.includes('ss command is missing')
            ? 'MISSING_DEPENDENCY'
            : 'DISCOVERY_FAILED';
  const stableMessage =
    code === 'INVALID_PORT'
      ? 'Port must be an integer between 1 and 65535.'
      : code === 'UNSUPPORTED_JSON_VERSION'
        ? 'Supported JSON schema version: 1.'
        : code === 'UNSUPPORTED_PLATFORM'
          ? 'Port discovery currently supports Linux only.'
          : code === 'MISSING_DEPENDENCY'
            ? 'The ss command is required. Install iproute2.'
            : 'Port discovery failed. Check permissions, iproute2, and namespace visibility.';
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    error: { code, message: stableMessage, ...(port === undefined ? {} : { port }) },
  };
}

export function jsonSchemaIsSupported(version: string | undefined): boolean {
  return version === undefined || version === String(JSON_SCHEMA_VERSION);
}
