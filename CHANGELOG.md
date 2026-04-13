# Changelog

## 0.1.0

- Initial reusable package release
- Mirrors WebChat user messages and assistant replies to Feishu
- Supports `main`, `webchat`, `all-webchat`, and `exact` rule matching
- Reuses `channels.feishu` credentials from the main OpenClaw config
- Persists dedupe state locally
- Includes hard guard against Feishu loopback duplication
