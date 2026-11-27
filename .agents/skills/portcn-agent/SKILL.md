---

name: portcn-agent
description: Use Portcn's local read-only MCP tools to inspect listening ports, visible process and project evidence, observed port availability, or unified Linux discovery relationships. Use when a coding agent needs evidence about local development services before suggesting a port or diagnosing a conflict.
---

# Portcn for coding agents

Use the published Portcn MCP server when a task needs a point-in-time view of local Linux listeners, visible owner processes, best-effort Git project evidence, port availability, or (on Linux) evidence-backed relationships across native listeners, containers, Nginx configuration, and systemd units. Prefer these tools over guessing from conventional ports. macOS listener results use the host view and do not include Linux process/project evidence or unified discovery.

**Release note:** npm `portcn@0.7.0` includes four MCP tools. The integration branch adds Linux `discovery_snapshot` and the `portcn discover snapshot` CLI command; use a current build or a release after `v0.7.0` for those surfaces.

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
- `discovery_snapshot` (Linux only, after `v0.7.0` release train): bounded relationship summary from the same coordinator as `portcn discover snapshot`; optional `full` provider payload; default 100 edges.

For Linux relationship detail without MCP, run `portcn discover snapshot --json-version 1` (optional `--full` for provider payloads).

## Interpret results

Treat every result as a read-only snapshot of the current Linux network and PID namespaces. `no-conflict-observed` and suggested ports are not reservations; a process can bind immediately afterward. Project paths and Git metadata describe the current filesystem and do not prove what code a running process loaded. Missing owner or project details can reflect permissions, process exits, or namespace boundaries.

Diagnosis intentionally omits command lines, user identifiers, agent names, session identifiers, and environment values. Do not infer service health from a listener. Use a separate explicit readiness check when application health matters.

Relationship edges distinguish observed, configured, inferred, incomplete, and unavailable evidence. Configured Nginx or systemd state does not prove an active listener.
