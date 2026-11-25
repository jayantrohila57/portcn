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
```

All discovery is read-only. `diagnose` reports each visible TCP/UDP socket, bind address, IPv4/IPv6 family, every visible PID/process owner, best-effort `/proc` details, and the current network/PID namespaces. It explains when permissions or namespaces hide information. A missing listener is not a guarantee that a later bind will succeed. Port numbers must be between 1 and 65535.

Successful diagnosis, including no visible listeners, exits with status 0. Invalid ports exit with status 2; discovery failures exit with status 1. With `--json`, errors are emitted as a JSON object on stdout with an `error.code` of `INVALID_PORT` or `DIAGNOSIS_FAILED`.

### Interactive dashboard

In `portcn list --interactive`, use `1`/`2`/`3`/`4` to switch All, TCP, UDP, and With Process tabs. Use `/` to search, `s` to change sorting, `r` to refresh, `n`/`p` for next/previous page, and `q` or `Ctrl+C` to quit. The footer always shows the available shortcuts; the layout adapts to the terminal size.

## Documentation and contributions

The current published version is `0.3.0` and includes all three commands listed above. Future capabilities in the [product roadmap](https://github.com/jayantrohila57/portcn/blob/dev/PRODUCT-ROADMAP.md) are proposals until released and documented as implemented.

The complete command reference and release policy are in the [Portcn documentation](https://jayantrohila57.github.io/portcn/). Development setup, checks, and contributor rules are in the repository [CONTRIBUTING.md](https://github.com/jayantrohila57/portcn/blob/main/CONTRIBUTING.md). Report bugs or request features in [GitHub Issues](https://github.com/jayantrohila57/portcn/issues).

## License

Portcn is released under the [MIT License](LICENSE).
