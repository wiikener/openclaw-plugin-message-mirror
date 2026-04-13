# Contributing

## Development Principles

- Keep the plugin hook-only unless there is a concrete reason to add more runtime surface area
- Prefer minimal changes over broader abstractions
- Preserve current working behavior for WebChat -> Feishu mirroring
- Treat loopback protection as a hard safety requirement

## Local Validation

Run these checks before updating the package:

```sh
npm run check
npm run pack:dry
openclaw doctor --non-interactive
openclaw gateway restart && openclaw gateway status
```

## Manual Verification

1. Send a message from `webchat:g-agent-main-main`
2. Confirm the target Feishu recipient receives the mirrored message
3. Reply from Feishu and confirm the plugin does not re-mirror that traffic back into Feishu

## Versioning

- Bump `package.json` and `openclaw.plugin.json` together
- Add a changelog entry for every user-visible behavior change
