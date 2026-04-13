# Known Issues

## 1. Assistant mirroring depends on a compatibility hook

Assistant reply mirroring currently depends on OpenClaw's `before_message_write` hook.

Why:

- In OpenClaw `2026.4.11`, the public WebChat outbound hooks were not reliable for the final reply text in this environment
- `reply_dispatch` exposed context-like data rather than the final WebChat-visible reply
- `message_sent` and `message_sending` did not consistently fire for the Control UI / WebChat reply path that was tested

Impact:

- Assistant mirroring is more sensitive to internal OpenClaw changes than user-message mirroring

What to check after upgrading OpenClaw:

1. If WebChat user messages still mirror but assistant replies stop mirroring, inspect the `before_message_write` path first
2. Re-run a minimal end-to-end test from WebChat to Feishu
3. Check OpenClaw logs for `message-mirror failed` entries

## 2. Feishu text length limits can reject large messages

The plugin currently sends plain text only. Large mirrored messages may fail with a Feishu message-length error.

Current behavior:

- The plugin logs the failure
- The main OpenClaw reply flow is not blocked

Future improvement ideas:

- Chunk oversized assistant replies
- Add configurable truncation or summarization before mirroring

## 3. Dedupe state is local and file-based

The plugin stores dedupe state in:

`~/.openclaw/plugins/message-mirror-state.json`

Implications:

- State is local to one machine/runtime
- Deleting the state file removes historical dedupe memory

## 4. Current transport is text-only

The current plugin mirrors text messages only.

Not yet handled:

- attachments
- images
- cards
- rich structured payloads

## 5. Fast troubleshooting checklist

If mirroring breaks, check in this order:

1. `openclaw gateway status`
2. `openclaw doctor --non-interactive`
3. `channels.feishu.appId` and `channels.feishu.appSecret`
4. `plugins.load.paths` and `plugins.entries.message-mirror`
5. `message-mirror failed` log entries in `/tmp/openclaw/*.log`
6. For assistant-only failures, re-check `before_message_write` compatibility assumptions
