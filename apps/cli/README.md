# portcn

Know what's running. Portcn is a read-only, Linux-first command-line tool for inspecting listening TCP and UDP ports.

## Install

```sh
npm install -g portcn
portcn --version
portcn --help
```

Node.js 24 or newer is required. Linux with `iproute2` (`ss`) is supported; process details are best effort and may be unavailable without additional permissions. macOS, Windows, and non-interactive environments can use the executable, but Linux port discovery is not available there.

## Commands

```sh
portcn                         # branded overview and available commands
portcn list                    # listening TCP/UDP ports
portcn list --json             # complete machine-readable result
portcn list --interactive      # full-screen dashboard
portcn inspect 3000            # details for every visible listener on port 3000
portcn inspect 3000 --json     # machine-readable inspection
```

All discovery is read-only. Port numbers must be between 1 and 65535. Missing listeners, restricted process details, IPv4/IPv6 addresses, and multiple listeners are reported without changing system state.

### Interactive dashboard

In `portcn list --interactive`, use `1`/`2`/`3`/`4` to switch All, TCP, UDP, and With Process tabs. Use `/` to search, `s` to change sorting, `r` to refresh, `n`/`p` for next/previous page, and `q` or `Ctrl+C` to quit. The footer always shows the available shortcuts; the layout adapts to the terminal size.

## Documentation and contributions

The complete command reference and release policy are in the [Portcn documentation](https://jayantrohila57.github.io/portcn/). Development setup, checks, and contributor rules are in the repository [CONTRIBUTING.md](https://github.com/jayantrohila57/portcn/blob/main/CONTRIBUTING.md). Report bugs or request features in [GitHub Issues](https://github.com/jayantrohila57/portcn/issues).

## License

Portcn is released under the [MIT License](LICENSE).
