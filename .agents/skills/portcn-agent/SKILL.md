---

name: portcn-agent
description: Use Portcn's local read-only MCP tools to inspect listening ports, visible process and project evidence, or observed port availability. Use when a coding agent needs evidence about local development services before suggesting a port or diagnosing a conflict.
---

# Portcn for coding agents

Use the Portcn MCP server when a task needs a point-in-time view of local Linux listeners, visible owner processes, best-effort Git project evidence, or port availability. Prefer these tools over guessing from conventional ports.

## Connect

Configure the host to launch `portcn mcp` as a local stdio MCP server. The published `portcn` executable must be on `PATH`; a source checkout can use `node /absolute/path/to/portcn/apps/cli/dist/index.js mcp` after `pnpm build`.

```json
{
  "mcpServers": {
    "portcn": {
      "command": "portcn",
      "args": ["mcp"]
    }
  }
}
```

## Choose a tool

- `list_listeners`: enumerate visible TCP/UDP listeners, optionally filter by protocol or cap the result count.
- `diagnose_port`: inspect listener owners and limited project checkout evidence for one port.
- `check_port_availability`: check observed overlap for a protocol and local bind address.
- `suggest_ports`: find a small set of candidates within a range of at most 1024 ports.

## Interpret results

Treat every result as a read-only snapshot of the current Linux network and PID namespaces. `no-conflict-observed` and suggested ports are not reservations; a process can bind immediately afterward. Project paths and Git metadata describe the current filesystem and do not prove what code a running process loaded. Missing owner or project details can reflect permissions, process exits, or namespace boundaries.

Diagnosis intentionally omits command lines, user identifiers, agent names, session identifiers, and environment values. Do not infer service health from a listener. Use a separate explicit readiness check when application health matters.
