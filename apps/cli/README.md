# portcn

Know what's running. Portcn is a read-only, Linux-first command-line tool for inspecting listening TCP and UDP ports.

## Install

```sh
npm install -g portcn
portcn --version
portcn --help
```

Node.js 24 or newer is required. Linux with `iproute2` (`ss`) is supported; process details are best effort and may be unavailable without additional permissions. macOS and Windows can use help and version output, but Linux discovery commands are unavailable there. Piped and other non-interactive Linux runs are supported.

## Commands

```sh
portcn                         # branded overview and available commands
portcn list                    # listening TCP/UDP ports
portcn list --json             # complete machine-readable result
portcn list --interactive      # full-screen dashboard
portcn inspect 3000            # details for every visible listener on port 3000
portcn inspect 3000 --json     # machine-readable inspection
portcn diagnose 3000           # owners, address families, and visibility limits
portcn diagnose 3000 --json    # machine-readable diagnosis
portcn check 3000              # dev: point-in-time TCP bind overlap check
portcn suggest                 # dev: bounded alternative port suggestions
portcn assess 1234 --project "$PWD" # dev: read-only ownership evidence
portcn verify 127.0.0.1:3000 --project "$PWD" # dev: local endpoint/project evidence
portcn config add tcp 127.0.0.1 3000 --favorite --alias web --group local # dev: save user-authored details
portcn config list --json    # dev: saved details with current listener status
portcn docker               # dev: read-only containers, Compose labels, and port mappings
portcn docker --json        # dev: versioned machine-readable container inventory
```

All discovery is read-only. `diagnose` reports each visible TCP/UDP socket, bind address, IPv4/IPv6 family, every visible PID/process owner, best-effort `/proc` details, and the current network/PID namespaces. On `dev`, it also reports bounded process ancestry, Git project/worktree evidence, and optional agent session markers when visible. Set `PORTCN_AGENT_SESSION_ID` to a non-secret session label and optionally `PORTCN_AGENT_NAME`; Portcn extracts only these exact keys from visible process environments and does not retain or emit other values. Attribution is user-supplied evidence, can be incomplete or ambiguous, and does not prove service ownership or session liveness. A possible leftover is not a safe-to-stop decision. It explains when permissions or namespaces hide information. A missing listener is not a guarantee that a later bind will succeed. Port numbers must be between 1 and 65535.

Successful diagnosis, including no visible listeners, exits with status 0. Invalid ports exit with status 2; discovery failures exit with status 1. With `--json`, errors are emitted as a JSON object on stdout with an `error.code` of `INVALID_PORT` or `DIAGNOSIS_FAILED`.

### Interactive dashboard

In `portcn list --interactive`, use `1`/`2`/`3`/`4` to switch All, TCP, UDP, and With Process tabs. Arrow keys or `j`/`k` move selection, and the contextual panel immediately shows the selected bind address, PID/process, and best-effort project evidence. Project paths describe the current checkout and do not prove which code the process loaded. Use `/` to search, `s` to change sorting, `r` to refresh, `n`/`p` for next/previous page, and `q` or `Ctrl+C` to quit. The footer shows available shortcuts; the layout adapts to the terminal size.

## Documentation and contributions

The current published version is `0.3.0` and includes the first three commands listed above. The `dev` branch adds `--json-version 1` plus read-only `check` and `suggest` commands; they will ship in a later package release. Future capabilities in the [product roadmap](https://github.com/jayantrohila57/portcn/blob/dev/PRODUCT-ROADMAP.md) are proposals until released and documented as implemented.

The `dev` branch also supports `portcn assess <pid> --project <path> [--session <id>]`; it reports matching, different, ambiguous, or unknown evidence with PID/start-time identity and observation time. These statuses are advisory and never authorize stopping or signaling a process. `portcn verify <endpoint> --project <path>` compares local TCP listener and current checkout metadata; it never connects or issues an HTTP request, and current Git branch/commit cannot prove what code an existing process loaded. The complete command reference and release policy are in the [Portcn documentation](https://jayantrohila57.github.io/portcn/). Development setup, checks, and contributor rules are in the repository [CONTRIBUTING.md](https://github.com/jayantrohila57/portcn/blob/main/CONTRIBUTING.md). Report bugs or request features in [GitHub Issues](https://github.com/jayantrohila57/portcn/issues).

## License

Portcn is released under the [MIT License](LICENSE).
