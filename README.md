# openclaw-plugin-message-mirror

Reusable native OpenClaw plugin for mirroring selected WebChat conversations to Feishu.

## 中文说明

`message-mirror` 是一个面向 OpenClaw 的原生插件，用来把指定 WebChat 会话中的消息镜像到飞书，并尽量保持对官方 OpenClaw 版本零侵入。

适用场景：

- 需要把 WebChat 主会话或指定会话同步到飞书私聊
- 希望保留 OpenClaw 官方版本，不再修改核心代码
- 需要一个可以长期维护、单独发布的插件包

当前实现特点：

- 支持镜像用户消息和助手回复
- 支持 `main`、`webchat`、`all-webchat`、`exact` 四种匹配模式
- 复用主配置中的 `channels.feishu.appId` 和 `channels.feishu.appSecret`
- 通过本地状态文件做去重
- 内置飞书回流硬保护，避免飞书消息再次被镜像回飞书造成重复

安装方式：

1. 把插件目录加入 `plugins.load.paths`
2. 在 `plugins.entries.message-mirror` 中启用插件
3. 配置至少一条规则，指定来源匹配方式和飞书目标 `to`

推荐规则：

- 如果主要处理 Control UI / WebChat 会话，优先使用 `all-webchat`
- 如果要精确限制到特定会话，再使用 `exact + sessionKeys`

运行注意事项：

- 当前只发送纯文本消息
- 发送链路使用 Feishu HTTP API
- 去重状态文件默认写在 `~/.openclaw/plugins/message-mirror-state.json`
- 建议在升级或修改逻辑前先执行 `npm run check` 和 `npm run pack:dry`
- 当前“助手回复镜像”依赖 `before_message_write` 兼容 hook；如果后续升级 OpenClaw 后出现只同步用户消息、不再同步助手回复，优先检查这里

长期维护建议：

- 将此目录作为独立 git 仓库维护
- 每次发布同步更新 `package.json`、`openclaw.plugin.json` 和 `CHANGELOG.md`
- 优先通过插件演进能力，不再回到 patch OpenClaw 内核的方式

## English Overview

This plugin is designed for teams who want to keep running the official OpenClaw release while adding a maintainable WebChat -> Feishu mirror as a standalone package.

## What It Does

- Mirrors WebChat user messages to Feishu
- Mirrors assistant final replies to Feishu
- Lets you scope mirroring with rule-based session matching
- Reuses existing `channels.feishu` credentials from your main OpenClaw config
- Persists local dedupe state to reduce duplicate sends
- Hard-blocks Feishu loopback cases to avoid mirror storms

## Features

- Mirrors WebChat user messages to Feishu
- Mirrors assistant final replies to Feishu
- Supports `main`, `webchat`, `all-webchat`, and `exact` match modes
- Reuses `channels.feishu` credentials from your main OpenClaw config
- Persists dedupe state locally
- Includes a hard guard against Feishu direct-session loopback duplication

## Use Cases

- Mirror your Control UI or WebChat assistant conversation into a Feishu DM
- Keep a human stakeholder updated in Feishu while continuing to operate from WebChat
- Add message mirroring without patching OpenClaw core

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

Recommended rule for Control UI or WebChat usage:

- Use `all-webchat` first
- Use `exact` only when you want to restrict mirroring to explicit session keys

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
- Assistant-reply mirroring currently depends on the `before_message_write` compatibility hook because the public WebChat outbound hooks were not reliable for final reply text in OpenClaw `2026.4.11`

## Verification

After installation:

1. Send a message from your WebChat session
2. Confirm the configured Feishu recipient receives it
3. Reply from Feishu and confirm the plugin does not mirror that reply back into Feishu again

## Reuse

This package can be copied to another machine and loaded by absolute path, or published privately as a tarball/npm package if you want centralized distribution.

## Long-Term Maintenance

- Track changes in `CHANGELOG.md`
- Use `npm run check` for syntax validation
- Use `npm run pack:dry` before packaging or publishing
- Keep `package.json` and `openclaw.plugin.json` versions aligned
- Prefer releasing this package independently rather than patching OpenClaw core
