# portcn

Know what's running. Portcn is a Linux-first CLI for inspecting local development services. Runtime discovery is read-only; the published package is `portcn@0.7.0` and requires Node.js 22 or later. Process termination and service lifecycle management are not implemented.

## Install

```sh
npm install -g portcn
portcn --version
portcn --help
```

On Linux, listener discovery requires `ss` from `iproute2`. Docker inventory additionally requires the user's Docker CLI and access to its selected daemon/context. These operations use existing permissions and do not request elevation.

The package includes limited macOS `list`, `inspect`, and `diagnose` support through `lsof`. macOS process command lines, user IDs, project paths, and agent markers are unavailable. Windows listener discovery is not implemented; help and version output remain available where Node.js runs.

## Commands

```sh
portcn                         # interactive dashboard in a TTY; help otherwise
portcn list                    # visible listening TCP/UDP ports
portcn list --json-version 1   # deterministic versioned JSON
portcn list --interactive      # listener dashboard
portcn inspect 3000            # visible listeners on port 3000
portcn diagnose 3000           # owners and visibility limits
portcn check 3000              # point-in-time listener overlap
portcn wait 3000               # bounded wait; does not reserve the port
portcn suggest                 # bounded alternative port suggestions
portcn assess 1234 --project "$PWD" # read-only ownership evidence
portcn verify 127.0.0.1:3000 --project "$PWD" # endpoint/project evidence
portcn config add tcp 127.0.0.1 3000 --favorite --alias web --group local
portcn endpoint list           # local URL candidates; no probe
portcn endpoint check tcp://127.0.0.1:3000 # explicit bounded HTTP check
portcn open tcp://127.0.0.1:3000 # explicit local browser open
portcn readiness list          # saved services and current listener state
portcn connection check tcp://127.0.0.1:3000 --json
portcn docker --json           # read-only container inventory
portcn exposure --json         # bind scope and potential exposure
portcn discover snapshot --json # unified Linux discovery relationships (additive)
portcn mcp                     # read-only stdio MCP server (includes discovery_snapshot on Linux)
```

The CLI also supports `config edit`, `config remove`, `config group`, and `config recover`. See the [CLI reference](https://jayantrohila57.github.io/portcn/docs/cli-reference) for bounds, JSON schemas, exit codes, and limitations.

## Evidence and safety

Portcn reports a point-in-time view of sockets visible in its current network namespace and process permissions. A missing listener does not guarantee a later bind will succeed. Docker inventory follows the selected Docker context; a remote context may describe a different host than local listener observations. Wildcard binds do not prove public reachability.

Linux diagnosis can include bounded process ancestry, Git project/worktree evidence, and opt-in `PORTCN_AGENT_SESSION_ID` / `PORTCN_AGENT_NAME` markers. Markers are user-supplied evidence, not verified identities. Project paths describe the current filesystem and do not prove which code a process loaded. A possible leftover is never a safe-to-stop decision.

The MCP server exposes bounded read-only listener, diagnosis, availability, and suggestion tools on all supported platforms. On Linux it also exposes `discovery_snapshot` (same coordinator as `discover snapshot`) after the current integration branch; published `portcn@0.7.0` on npm includes four tools only until the next release. It does not expose a shell or process-control operation. Local probes are explicit, bounded, and do not follow redirects or disable TLS validation.

## Development

The source workspace requires Node.js 24 or later and pnpm 12.3.4. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
node apps/cli/dist/index.js --help
pnpm test
```

Follow the [contribution guide](../../CONTRIBUTING.md) and [Linux-first roadmap](../../PRODUCT-ROADMAP.md). The roadmap records the verified status; GitHub issue acceptance criteria are authoritative.

## License

MIT. See [LICENSE](LICENSE).
