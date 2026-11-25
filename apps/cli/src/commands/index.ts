import type { Command } from 'commander';
import { registerAvailabilityCommands } from './availability.js';
import { registerConfigCommand } from './config.js';
import { registerDiagnoseCommand } from './diagnose.js';
import { registerDockerCommand } from './docker.js';
import { registerEndpointVerificationCommand } from './endpoint-verification.js';
import { registerExposureCommand } from './exposure.js';
import { registerInspectCommand } from './inspect.js';
import { registerListCommand } from './list.js';
import { registerProcessAssessmentCommand } from './process-assessment.js';

/** Register CLI commands in one place so future commands stay independent. */
export function registerCommands(program: Command): void {
  registerListCommand(program);
  registerInspectCommand(program);
  registerDiagnoseCommand(program);
  registerAvailabilityCommands(program);
  registerProcessAssessmentCommand(program);
  registerEndpointVerificationCommand(program);
  registerConfigCommand(program);
  registerDockerCommand(program);
  registerExposureCommand(program);
}
