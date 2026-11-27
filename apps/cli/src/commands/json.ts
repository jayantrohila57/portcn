export const JSON_SCHEMA_VERSION = 1;

export type JsonErrorCode =
  | 'INVALID_PORT'
  | 'INVALID_INPUT'
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

export class InvalidAvailabilityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAvailabilityInputError';
  }
}

export class InvalidProcessAssessmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProcessAssessmentInputError';
  }
}

export class InvalidProjectDiscoveryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProjectDiscoveryInputError';
  }
}

export function versionedJsonError(error: unknown, port?: string): VersionedJsonError {
  const message = error instanceof Error ? error.message : String(error);
  const code: JsonErrorCode =
    error instanceof Error && error.name === 'InvalidPortError'
      ? 'INVALID_PORT'
      : error instanceof InvalidAvailabilityInputError
        ? 'INVALID_INPUT'
        : error instanceof InvalidProcessAssessmentInputError || error instanceof InvalidProjectDiscoveryInputError
          ? 'INVALID_INPUT'
          : error instanceof UnsupportedJsonVersionError
            ? 'UNSUPPORTED_JSON_VERSION'
            : message.includes('supports Linux and macOS')
              ? 'UNSUPPORTED_PLATFORM'
              : message.includes('ss command is missing') || message.includes('lsof command is missing')
                ? 'MISSING_DEPENDENCY'
                : 'DISCOVERY_FAILED';
  const stableMessage =
    code === 'INVALID_PORT'
      ? 'Port must be an integer between 1 and 65535.'
      : code === 'INVALID_INPUT'
        ? message
        : code === 'UNSUPPORTED_JSON_VERSION'
          ? 'Supported JSON schema version: 1.'
          : code === 'UNSUPPORTED_PLATFORM'
            ? 'Port discovery currently supports Linux and macOS.'
            : code === 'MISSING_DEPENDENCY'
              ? message.includes('lsof')
                ? 'The lsof command is required on macOS.'
                : 'The ss command is required on Linux. Install iproute2.'
              : 'Port discovery failed. Check platform tooling and process permissions.';
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    error: { code, message: stableMessage, ...(port === undefined ? {} : { port }) },
  };
}

export function jsonSchemaIsSupported(version: string | undefined): boolean {
  return version === undefined || version === String(JSON_SCHEMA_VERSION);
}
