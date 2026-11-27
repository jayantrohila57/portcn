import type { Command } from 'commander';
import { registerAvailabilityCommands } from './availability.js';
import { registerConfigCommand } from './config.js';
import { registerConnectionCommands } from './connection.js';
import { registerDiagnoseCommand } from './diagnose.js';
import { registerDiscoverCommand } from './discover.js';
import { registerDockerCommand } from './docker.js';
import { registerEndpointVerificationCommand } from './endpoint-verification.js';
import { registerEndpointCommands } from './endpoints.js';
import { registerExposureCommand } from './exposure.js';
import { registerInspectCommand } from './inspect.js';
import { registerListCommand } from './list.js';
import { registerMcpCommand } from './mcp.js';
import { registerNginxCommand } from './nginx.js';
import { registerPodmanCommand } from './podman.js';
import { registerProcessAssessmentCommand } from './process-assessment.js';
import { registerReadinessCommands } from './readiness.js';
import { registerSystemdCommand } from './systemd.js';

/** Register CLI commands in one place so future commands stay independent. */
export function registerCommands(program: Command): void {
  registerListCommand(program);
  registerInspectCommand(program);
  registerDiagnoseCommand(program);
  registerDiscoverCommand(program);
  registerAvailabilityCommands(program);
  registerProcessAssessmentCommand(program);
  registerEndpointVerificationCommand(program);
  registerEndpointCommands(program);
  registerReadinessCommands(program);
  registerConnectionCommands(program);
  registerConfigCommand(program);
  registerDockerCommand(program);
  registerPodmanCommand(program);
  registerNginxCommand(program);
  registerSystemdCommand(program);
  registerExposureCommand(program);
  registerMcpCommand(program);
}
