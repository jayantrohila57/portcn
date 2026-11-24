import type { Command } from 'commander';
import { registerInspectCommand } from './inspect.js';
import { registerListCommand } from './list.js';

/** Register CLI commands in one place so future commands stay independent. */
export function registerCommands(program: Command): void {
  registerListCommand(program);
  registerInspectCommand(program);
}
