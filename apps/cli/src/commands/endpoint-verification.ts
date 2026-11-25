import { isIP } from 'node:net';
import type { Command } from 'commander';
import { formatEmpty } from '../terminal.js';
import {
  InvalidProcessAssessmentInputError,
  JSON_SCHEMA_VERSION,
  jsonSchemaIsSupported,
  UnsupportedJsonVersionError,
  versionedJsonError,
} from './json.js';
import { discoverListeningPorts, type ListeningPort } from './list.js';
import { type GitMetadata, inspectProjectContext, type ProjectContext, resolveGitProject } from './project-context.js';

export type EndpointVerificationStatus = 'matching' | 'different' | 'ambiguous' | 'unavailable';

export interface LocalEndpoint {
  scheme: 'http' | 'https';
  host: string;
  port: number;
  addressesChecked: string[];
}

export interface EndpointListenerEvidence {
  address: string;
  port: number;
  ownerPid: number | null;
  processName: string | null;
  projectStatus: ProjectContext['status'] | 'owner-hidden';
  projectRoot: string | null;
  checkoutBranch: string | null;
  checkoutCommit: string | null;
  evidence: string[];
}

export interface EndpointSuggestion {
  endpoint: string;
  address: string;
  port: number;
  ownerPid: number;
  projectRoot: string;
  checkoutBranch: string | null;
  checkoutCommit: string | null;
}

export interface EndpointVerification {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  status: EndpointVerificationStatus;
  endpoint: LocalEndpoint;
  expectedProject: { root: string; branch: string | null; commit: string | null };
  listeners: EndpointListenerEvidence[];
  suggestions: EndpointSuggestion[];
  suggestionsComplete: boolean;
  runtimeCode: 'unverified';
  observedAt: string;
  messages: string[];
  limitations: string[];
}

export interface EndpointVerificationDependencies {
  discover?: () => ListeningPort[];
  resolveProject?: (directory: string) => GitMetadata | null;
  inspectProject?: (pid: number) => ProjectContext;
  now?: () => Date;
  maxSuggestionOwners?: number;
  maxProjectInspections?: number;
  maxListeners?: number;
}

interface ParsedEndpoint extends LocalEndpoint {
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

function normalizedIp(value: string): { address: string; family: 4 | 6 } | null {
  const family = isIP(value);
  if (family === 4) return { address: value, family: 4 };
  if (family === 6) {
    try {
      const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
      return { address: canonical, family: 6 };
    } catch {
      return null;
    }
  }
  return null;
}

export function parseLocalEndpoint(value: string): ParsedEndpoint {
  const input = value.includes('://') ? value : `http://${value}`;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidProcessAssessmentInputError('Endpoint must be a local HTTP(S) endpoint with an explicit port.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
    throw new InvalidProcessAssessmentInputError('Endpoint must use HTTP(S) and cannot include credentials.');
  const authority = input.replace(/^https?:\/\//i, '').split(/[/?#]/, 1)[0] ?? '';
  const portMatch = authority.startsWith('[') ? /^\[[^\]]+\]:(\d+)$/.exec(authority) : /^[^:]+:(\d+)$/.exec(authority);
  const port = Number(portMatch?.[1]);
  if (!portMatch || !Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new InvalidProcessAssessmentInputError('Endpoint must include an explicit port between 1 and 65535.');

  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname.toLowerCase();
  const addresses =
    host === 'localhost'
      ? [
          { address: '127.0.0.1', family: 4 as const },
          { address: '::1', family: 6 as const },
        ]
      : [normalizedIp(host)].filter((address): address is { address: string; family: 4 | 6 } => address !== null);
  if (!addresses.length)
    throw new InvalidProcessAssessmentInputError(
      'Endpoint host must be localhost or an IPv4/IPv6 literal; DNS is not used.',
    );
  return {
    scheme: url.protocol === 'https:' ? 'https' : 'http',
    host,
    port,
    addressesChecked: addresses.map(({ address }) => address),
    addresses,
  };
}

function listenerAddress(address: string): { address: string; family: 4 | 6; wildcard: boolean } | null {
  const value = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const parsed = normalizedIp(value);
  if (!parsed) return null;
  const wildcard = parsed.family === 4 ? parsed.address === '0.0.0.0' : parsed.address === '::';
  return { ...parsed, wildcard };
}

function matchesEndpoint(endpoint: ParsedEndpoint, address: string): { matches: boolean; uncertain: boolean } {
  const observed = listenerAddress(address);
  if (!observed) return { matches: false, uncertain: true };
  let uncertain = false;
  for (const requested of endpoint.addresses) {
    if (requested.family === observed.family) {
      if (observed.wildcard || observed.address === requested.address) return { matches: true, uncertain: false };
      continue;
    }
    if (observed.wildcard) uncertain = true;
  }
  return { matches: false, uncertain };
}

function displayEndpoint(scheme: 'http' | 'https', address: string, port: number): string {
  const parsed = listenerAddress(address);
  const host = parsed?.family === 6 ? `[${parsed.address}]` : address;
  return `${scheme}://${host}:${port}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function evidenceForListener(
  listener: ListeningPort,
  inspect: (pid: number) => ProjectContext,
  expected: GitMetadata,
): EndpointListenerEvidence[] {
  const owners =
    listener.owners ??
    (listener.pid !== null && listener.processName !== null
      ? [{ pid: listener.pid, processName: listener.processName }]
      : []);
  if (owners.length === 0)
    return [
      {
        address: listener.address,
        port: listener.port,
        ownerPid: null,
        processName: listener.processName,
        projectStatus: 'owner-hidden',
        projectRoot: null,
        checkoutBranch: null,
        checkoutCommit: null,
        evidence: ['The listener is visible, but no process owner is available.'],
      },
    ];
  return [...owners]
    .sort((left, right) => left.pid - right.pid || compareText(left.processName, right.processName))
    .map((owner) => {
      const project = inspect(owner.pid);
      const sameRoot = project.status === 'identified' && project.projectRoot === expected.projectRoot;
      const sameBranch = project.checkoutBranch === expected.checkoutBranch;
      const sameCommit = project.checkoutCommit === expected.checkoutCommit;
      const branchDiffers = Boolean(project.checkoutBranch && expected.checkoutBranch && !sameBranch);
      const commitDiffers = Boolean(project.checkoutCommit && expected.checkoutCommit && !sameCommit);
      const evidence = [
        `Project context is ${project.status} with ${project.confidence} confidence from ${project.source ?? 'no'} directory evidence.`,
        ...(sameRoot ? [`Current Git project root matches ${expected.projectRoot}.`] : []),
        ...(project.status === 'identified' && !sameRoot
          ? [`Current Git project root is ${project.projectRoot}; expected ${expected.projectRoot}.`]
          : []),
        ...(sameRoot && sameBranch && sameCommit
          ? ['Current checkout branch and commit match the expected checkout snapshot.']
          : []),
        ...(branchDiffers
          ? [
              `Current checkout branch differs: observed ${project.checkoutBranch}; expected ${expected.checkoutBranch}.`,
            ]
          : []),
        ...(commitDiffers
          ? [
              `Current checkout commit differs: observed ${project.checkoutCommit}; expected ${expected.checkoutCommit}.`,
            ]
          : []),
        'Current checkout metadata does not prove which source code the running process loaded.',
      ];
      return {
        address: listener.address,
        port: listener.port,
        ownerPid: owner.pid,
        processName: owner.processName,
        projectStatus: project.status,
        projectRoot: project.projectRoot,
        checkoutBranch: project.checkoutBranch,
        checkoutCommit: project.checkoutCommit,
        evidence,
      };
    });
}

export function verifyEndpointProject(
  endpointValue: string,
  projectDirectory: string,
  dependencies: EndpointVerificationDependencies = {},
): EndpointVerification {
  if (!projectDirectory.trim()) throw new InvalidProcessAssessmentInputError('A Git project path is required.');
  const endpoint = parseLocalEndpoint(endpointValue);
  const expected = (dependencies.resolveProject ?? resolveGitProject)(projectDirectory);
  if (!expected)
    throw new InvalidProcessAssessmentInputError(
      'Expected project path must exist and resolve inside a Git repository.',
    );
  const discover = dependencies.discover ?? (() => discoverListeningPorts());
  const allListeners = discover()
    .filter((listener) => listener.protocol === 'tcp')
    .sort((left, right) => left.port - right.port || compareText(left.address, right.address));
  const maxListeners = dependencies.maxListeners ?? 512;
  const boundedListeners = allListeners.slice(0, maxListeners);
  const suggestionsComplete = allListeners.length <= maxListeners;
  const inspect = dependencies.inspectProject ?? inspectProjectContext;
  const projectCache = new Map<number, ProjectContext>();
  const maxProjectInspections = dependencies.maxProjectInspections ?? 32;
  let ownerInspectionComplete = true;
  const contextFor = (pid: number): ProjectContext => {
    const existing = projectCache.get(pid);
    if (existing) return existing;
    if (projectCache.size >= maxProjectInspections) {
      ownerInspectionComplete = false;
      return {
        status: 'unavailable',
        confidence: 'none',
        source: null,
        cwd: null,
        executable: null,
        projectRoot: null,
        gitDir: null,
        gitCommonDir: null,
        checkoutBranch: null,
        checkoutCommit: null,
        worktree: null,
        ancestors: [],
        evidence: ['The bounded project inspection limit was reached.'],
      };
    }
    const value = inspect(pid);
    projectCache.set(pid, value);
    return value;
  };
  const matchingSocketRows = boundedListeners.filter(
    (listener) => listener.port === endpoint.port && matchesEndpoint(endpoint, listener.address).matches,
  );
  const exactEvidence = matchingSocketRows.flatMap((listener) => evidenceForListener(listener, contextFor, expected));
  const exactInspectionComplete = ownerInspectionComplete;
  const matchingEvidence = exactEvidence.filter(
    (item) =>
      item.projectStatus === 'identified' &&
      item.projectRoot === expected.projectRoot &&
      item.checkoutBranch === expected.checkoutBranch &&
      item.checkoutCommit === expected.checkoutCommit &&
      (expected.checkoutBranch === null || item.checkoutBranch !== null) &&
      (expected.checkoutCommit === null || item.checkoutCommit !== null),
  );
  const incompleteEvidence = exactEvidence.some(
    (item) =>
      item.projectStatus === 'owner-hidden' ||
      item.projectStatus !== 'identified' ||
      !exactInspectionComplete ||
      (item.projectRoot === expected.projectRoot &&
        ((expected.checkoutBranch !== null && item.checkoutBranch === null) ||
          (expected.checkoutCommit !== null && item.checkoutCommit === null))),
  );
  const differentEvidence = exactEvidence.filter(
    (item) =>
      item.projectStatus === 'identified' &&
      (item.projectRoot !== expected.projectRoot ||
        (item.checkoutBranch !== null &&
          expected.checkoutBranch !== null &&
          item.checkoutBranch !== expected.checkoutBranch) ||
        (item.checkoutCommit !== null &&
          expected.checkoutCommit !== null &&
          item.checkoutCommit !== expected.checkoutCommit)),
  );
  const uncertainAddress = boundedListeners.some(
    (listener) => listener.port === endpoint.port && matchesEndpoint(endpoint, listener.address).uncertain,
  );
  const status: EndpointVerificationStatus =
    matchingEvidence.length &&
    (differentEvidence.length || incompleteEvidence || exactEvidence.some((item) => item.projectStatus === 'ambiguous'))
      ? 'ambiguous'
      : differentEvidence.length && incompleteEvidence
        ? 'ambiguous'
        : matchingEvidence.length
          ? 'matching'
          : differentEvidence.length
            ? 'different'
            : uncertainAddress || exactEvidence.some((item) => item.projectStatus === 'ambiguous')
              ? 'ambiguous'
              : 'unavailable';

  const maxSuggestionOwners = dependencies.maxSuggestionOwners ?? 32;
  const seenOwners = new Set<number>();
  const suggestions: EndpointSuggestion[] = [];
  let suggestionScanComplete = suggestionsComplete && ownerInspectionComplete;
  for (const [listenerIndex, listener] of boundedListeners.entries()) {
    if (
      listener.port === endpoint.port ||
      listener.address.startsWith('0.0.0.0') ||
      listener.address === '[::]' ||
      listener.address === '::'
    )
      continue;
    const owners =
      listener.owners ??
      (listener.pid !== null && listener.processName !== null
        ? [{ pid: listener.pid, processName: listener.processName }]
        : []);
    for (const owner of owners) {
      if (!seenOwners.has(owner.pid) && seenOwners.size >= maxSuggestionOwners) {
        suggestionScanComplete = false;
        break;
      }
      seenOwners.add(owner.pid);
      const context = contextFor(owner.pid);
      if (
        context.status === 'identified' &&
        context.projectRoot === expected.projectRoot &&
        context.checkoutBranch === expected.checkoutBranch &&
        context.checkoutCommit === expected.checkoutCommit
      ) {
        suggestions.push({
          endpoint: displayEndpoint(endpoint.scheme, listener.address, listener.port),
          address: listener.address,
          port: listener.port,
          ownerPid: owner.pid,
          projectRoot: context.projectRoot,
          checkoutBranch: context.checkoutBranch,
          checkoutCommit: context.checkoutCommit,
        });
      }
    }
    if (!suggestionScanComplete) break;
    if (suggestions.length >= 5) {
      if (listenerIndex < boundedListeners.length - 1) suggestionScanComplete = false;
      break;
    }
  }
  const uniqueSuggestions = [...new Map(suggestions.map((item) => [item.endpoint, item])).values()].slice(0, 5);
  const messages = [
    status === 'matching'
      ? 'Visible listener ownership and current checkout metadata match the supplied project.'
      : status === 'different'
        ? 'The visible listener is associated with a different project or current checkout revision.'
        : status === 'ambiguous'
          ? 'Listener address or project ownership evidence is ambiguous.'
          : 'No matching visible listener ownership evidence could be established for this endpoint.',
    'Current checkout metadata does not prove which source code a running process has loaded.',
  ];
  if (uncertainAddress) messages.push('IPv4/IPv6 wildcard behavior may depend on socket dual-stack settings.');
  if (uniqueSuggestions.length)
    messages.push(`Found ${uniqueSuggestions.length} discovered endpoint suggestion(s) for this project checkout.`);
  else messages.push('No alternative endpoint is suggested because no matching owned listener was discovered.');
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    status,
    endpoint: {
      scheme: endpoint.scheme,
      host: endpoint.host,
      port: endpoint.port,
      addressesChecked: endpoint.addressesChecked,
    },
    expectedProject: {
      root: expected.projectRoot,
      branch: expected.checkoutBranch,
      commit: expected.checkoutCommit,
    },
    listeners: exactEvidence,
    suggestions: uniqueSuggestions,
    suggestionsComplete: suggestionScanComplete,
    runtimeCode: 'unverified',
    observedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    messages,
    limitations: [
      'Portcn only reads the current socket snapshot and visible process/Git metadata; it does not connect to the endpoint or issue an HTTP request.',
      'The current branch and commit describe the checkout at observation time, not code already loaded by a running process.',
      'Discovery is limited to the current network/PID namespaces and user permissions; a listener may start or stop after this snapshot.',
      ...(!suggestionScanComplete
        ? ['The bounded endpoint suggestion scan was truncated; additional matches may exist.']
        : []),
    ],
  };
}

export function formatEndpointVerification(result: EndpointVerification): string {
  const lines = [
    `Endpoint verification: ${result.status.toUpperCase()}`,
    `${result.endpoint.scheme}://${result.endpoint.host}:${result.endpoint.port}`,
    ...result.messages,
    `Expected checkout: ${result.expectedProject.root} (${result.expectedProject.branch ?? 'branch unknown'} @ ${result.expectedProject.commit ?? 'commit unknown'})`,
  ];
  if (result.listeners.length) {
    lines.push(
      'Observed listeners:',
      ...result.listeners.map(
        (listener) =>
          `- ${listener.address}:${listener.port} PID ${listener.ownerPid ?? 'unknown'}; project ${listener.projectRoot ?? listener.projectStatus}; checkout ${listener.checkoutBranch ?? 'unknown'} @ ${listener.checkoutCommit ?? 'unknown'}`,
      ),
    );
  } else lines.push(formatEmpty('No listener matched this address and port.'));
  if (result.suggestions.length)
    lines.push(
      'Discovered matching endpoint suggestions:',
      ...result.suggestions.map(({ endpoint }) => `- ${endpoint}`),
    );
  lines.push(...result.limitations.map((limitation) => `- ${limitation}`));
  return lines.join('\n');
}

export function registerEndpointVerificationCommand(program: Command): void {
  program
    .command('verify <endpoint>')
    .description('Compare a local TCP endpoint listener with an expected Git project (Linux, read-only)')
    .requiredOption('--project <path>', 'Expected Git project directory')
    .option('--json', 'Print versioned JSON')
    .option('--json-version <version>', 'Print versioned JSON (supported: 1)')
    .action((value: string, options: { project: string; json?: boolean; jsonVersion?: string }) => {
      try {
        if (!jsonSchemaIsSupported(options.jsonVersion)) throw new UnsupportedJsonVersionError();
        const result = verifyEndpointProject(value, options.project);
        process.stdout.write(
          `${options.json || options.jsonVersion ? JSON.stringify(result) : formatEndpointVerification(result)}\n`,
        );
      } catch (error) {
        const json = options.json || options.jsonVersion !== undefined;
        if (json) process.stdout.write(`${JSON.stringify(versionedJsonError(error))}\n`);
        else process.stderr.write(`portcn: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode =
          error instanceof InvalidProcessAssessmentInputError || error instanceof UnsupportedJsonVersionError ? 2 : 1;
      }
    });
}
