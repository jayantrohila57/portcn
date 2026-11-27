import { summarizeDiscoveryRelationships } from '@portcn/core';
import type { Command } from 'commander';
import { registerDiscoverProjectCommand } from './discover-project.js';
import { collectLinuxDiscoverySnapshot } from './discovery-coordinator.js';
import { JSON_SCHEMA_VERSION, jsonSchemaIsSupported, UnsupportedJsonVersionError } from './json.js';

function formatCorrelationLine(
  correlation: ReturnType<typeof summarizeDiscoveryRelationships>['correlations'][number],
): string {
  return `${correlation.type} ${correlation.nature}/${correlation.freshness} ${correlation.confidence} ${correlation.fromIdentityKey} -> ${correlation.toIdentityKey}`;
}

export function registerDiscoverCommand(program: Command): void {
  const discover = program.command('discover').description('Collect unified Linux discovery snapshots (read-only).');
  registerDiscoverProjectCommand(discover);
  discover
    .command('snapshot')
    .description('Collect provider observations and evidence-backed service relationships.')
    .option('--json', 'Print versioned JSON')
    .option('--json-version <version>', 'JSON schema version when using --json', String(JSON_SCHEMA_VERSION))
    .option('--full', 'Include the complete provider result set in JSON output')
    .action((options: { json?: boolean; jsonVersion?: string; full?: boolean }) => {
      if (process.platform !== 'linux')
        throw new Error('Unified discovery snapshot collection is available only on Linux.');
      const snapshot = collectLinuxDiscoverySnapshot();
      const summary = summarizeDiscoveryRelationships(snapshot);
      if (options.json) {
        const jsonVersion = Number(options.jsonVersion ?? JSON_SCHEMA_VERSION);
        if (!jsonSchemaIsSupported(String(jsonVersion))) throw new UnsupportedJsonVersionError();
        const payload = options.full ? { ...summary, providers: snapshot.providers } : summary;
        process.stdout.write(`${JSON.stringify({ schemaVersion: jsonVersion, discovery: payload }, null, 2)}\n`);
        return;
      }
      const lines = [
        `Discovery snapshot (${summary.status}) at ${summary.requestedAt}.`,
        `Providers: ${summary.providerCount}; observations: ${summary.observationCount}; relationships: ${summary.correlationCount}.`,
        ...summary.correlations.slice(0, 50).map((correlation) => formatCorrelationLine(correlation)),
      ];
      if (summary.correlationCount > 50)
        lines.push(`... ${summary.correlationCount - 50} additional relationships omitted.`);
      process.stdout.write(`${lines.join('\n')}\n`);
    });
}
