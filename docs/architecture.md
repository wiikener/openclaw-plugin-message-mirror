# Architecture

## Goal

`message-mirror` mirrors selected OpenClaw WebChat conversations to Feishu without patching OpenClaw core.

The plugin is intentionally narrow:

- mirror user messages from WebChat to Feishu
- mirror assistant replies from OpenClaw to Feishu
- avoid Feishu loopback duplication
- keep all behavior isolated in a standalone plugin package

## High-Level Flow

```text
WebChat user input
  -> OpenClaw inbound processing
  -> message-mirror user hook
  -> Feishu text send

OpenClaw assistant reply
  -> session write path
  -> message-mirror assistant hook
  -> Feishu text send

Feishu reply or direct-session traffic
  -> OpenClaw inbound processing
  -> loopback guard detects Feishu-origin source
  -> skip mirror
```

## Why The Plugin Uses Different Hooks For User And Assistant Messages

### User messages

User mirroring is driven by the public `message_received` hook.

Why it works well enough:

- it fires reliably for WebChat inbound traffic in the tested environment
- it exposes the inbound message content cleanly
- it is a non-blocking observation hook, which is a good fit for side effects like mirroring

Tradeoff:

- the WebChat `message_received` event did not expose a strong session key for all tested Control UI flows
- because of that, `all-webchat` is the most reliable default rule for real-world usage

### Assistant replies

Assistant mirroring is driven by `before_message_write`.

Why:

- in OpenClaw `2026.4.11`, the public outbound WebChat hooks were not reliable for the final assistant reply text in this setup
- `reply_dispatch` exposed context-like data rather than the exact final reply shown in WebChat
- `message_sent` and `message_sending` were not consistently triggered for the tested Control UI / WebChat assistant reply path
- `before_message_write` was the first stable place where the assistant message content matched the final reply that users actually saw

Tradeoff:

- this is a compatibility hook rather than the ideal public API
- future OpenClaw upgrades may require revalidation here

## Internal Components

## 1. Rule matcher

The rule matcher decides whether a message should be mirrored.

Supported match modes:

- `main`
- `webchat`
- `all-webchat`
- `exact`

Recommended default:

- `all-webchat`

Reason:

- it is the most reliable option when WebChat session metadata is incomplete or differently shaped across Control UI flows

## 2. Feishu sender

The plugin sends mirrored text through Feishu HTTP APIs.

Current design:

- reuse `channels.feishu.appId` and `channels.feishu.appSecret`
- fetch a tenant access token
- send plain text to Feishu via `im/v1/messages`
- use `curl` rather than Node `fetch` inside the plugin runtime, because `curl` proved more reliable in the tested environment

## 3. Dedupe state

Mirroring is protected by a local dedupe store.

State file:

`~/.openclaw/plugins/message-mirror-state.json`

Purpose:

- avoid sending the same mirrored message multiple times for the same rule/role/content combination

## 4. Loopback guard

The loopback guard prevents Feishu-originated traffic from being mirrored back into Feishu.

It blocks mirror attempts when the source already looks Feishu-derived, for example:

- `channel === "feishu"`
- `originatingChannel === "feishu"`
- session keys that contain Feishu direct-session patterns
- sender/target combinations that clearly indicate a Feishu echo path

This guard is mandatory because a mirror loop is much more dangerous than a missed mirror.

## Message Flow Details

### User flow

```text
WebChat user sends message
  -> OpenClaw emits message_received
  -> plugin checks channel and rules
  -> plugin checks loopback guard
  -> plugin computes dedupe key
  -> plugin sends [WebChat User] message to Feishu
```

### Assistant flow

```text
OpenClaw generates assistant reply
  -> OpenClaw writes assistant message to session
  -> plugin sees before_message_write
  -> plugin extracts assistant text from message.content
  -> plugin checks loopback guard and dedupe
  -> plugin sends [OpenClaw] message to Feishu
```

## Failure Strategy

Mirroring is best-effort.

Design rule:

- mirror failures must not block the main OpenClaw reply flow

Current behavior:

- failures are logged with `message-mirror failed ...`
- successful sends are logged with `message-mirror sent ...`
- Feishu API errors do not stop the user from continuing to use OpenClaw

## Upgrade Risk

Most stable parts:

- Feishu sender
- rule matcher
- dedupe
- loopback guard

Most fragile part:

- assistant reply capture via `before_message_write`

Practical implication:

- after upgrading OpenClaw, assistant mirroring is the first thing that should be re-tested
- if user mirroring still works but assistant mirroring stops, start debugging from the assistant hook path

## Recommended Validation After Changes

1. Send a WebChat user message and confirm Feishu receives `[WebChat User] ...`
2. Confirm OpenClaw replies in WebChat
3. Confirm Feishu receives `[OpenClaw] ...`
4. Reply from Feishu and confirm no loopback duplication occurs
5. Check `/tmp/openclaw/*.log` for `message-mirror failed` entries if anything looks wrong
