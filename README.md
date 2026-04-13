# openclaw-plugin-message-mirror

Reusable native OpenClaw plugin for mirroring selected WebChat conversations to Feishu.

## Features

- Mirrors WebChat user messages to Feishu
- Mirrors assistant final replies to Feishu
- Supports `main`, `webchat`, `all-webchat`, and `exact` match modes
- Reuses `channels.feishu` credentials from your main OpenClaw config
- Persists dedupe state locally
- Includes a hard guard against Feishu direct-session loopback duplication

## Package Layout

- `index.js`: plugin runtime entry
- `openclaw.plugin.json`: manifest + config schema
- `examples/openclaw.plugin-config.json`: example `plugins.entries.message-mirror.config`

## Install

Add the package path to `plugins.load.paths` in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/Users/ken/.openclaw/packages/message-mirror"
      ]
    }
  }
}
```

Enable the plugin entry:

```json
{
  "plugins": {
    "entries": {
      "message-mirror": {
        "enabled": true,
        "config": {
          "dryRun": false,
          "rules": [
            {
              "id": "mirror-feishu-webchat",
              "enabled": true,
              "source": {
                "match": "all-webchat"
              },
              "target": {
                "channel": "feishu",
                "to": "ou_xxx"
              },
              "mirrorUser": true,
              "mirrorAssistant": true
            }
          ]
        }
      }
    }
  }
}
```

## Requirements

- OpenClaw `2026.4.11` or newer
- Node `22.19.0` or newer recommended
- `channels.feishu.appId` and `channels.feishu.appSecret` configured in the main OpenClaw config

## Match Modes

- `main`: main session semantics
- `webchat`: non-main webchat sessions
- `all-webchat`: both main and webchat-derived sessions
- `exact`: explicit `source.sessionKeys`

## Notes

- Current implementation sends plain text only
- Transport uses Feishu HTTP APIs via `curl`
- Dedupe state is stored in `~/.openclaw/plugins/message-mirror-state.json`
- Feishu-originated loopback traffic is hard-blocked to avoid duplicate mirrors

## Reuse

This package can be copied to another machine and loaded by absolute path, or published privately as a tarball/npm package if you want centralized distribution.

## Long-Term Maintenance

- Track changes in `CHANGELOG.md`
- Use `npm run check` for syntax validation
- Use `npm run pack:dry` before packaging or publishing
- Keep `package.json` and `openclaw.plugin.json` versions aligned
- Prefer releasing this package independently rather than patching OpenClaw core
