import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = "message-mirror-state.json";
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const tokenCache = new Map();
const execFileAsync = promisify(execFile);

function parseCurlJson(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) {
    throw new Error(`curl returned non-JSON output: ${text || "<empty>"}`);
  }
  return JSON.parse(text.slice(first, last + 1));
}

function sha(input) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.seen && typeof parsed.seen === "object"
      ? parsed
      : { seen: {} };
  } catch {
    return { seen: {} };
  }
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function pruneState(state, now) {
  for (const [key, ts] of Object.entries(state.seen)) {
    if (typeof ts !== "number" || now - ts > DEDUPE_TTL_MS) {
      delete state.seen[key];
    }
  }
}

function getPluginConfig(api) {
  const config = api.pluginConfig ?? {};
  const rules = Array.isArray(config.rules) ? config.rules : [];
  return {
    dryRun: config.dryRun === true,
    rules,
  };
}

function resolveApiBase(domain) {
  const trimmed = normalizeText(domain);
  if (!trimmed || trimmed === "feishu" || !trimmed.includes(".")) {
    return "https://open.feishu.cn";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeFeishuTarget(raw) {
  const trimmed = normalizeText(raw).replace(/^(feishu|lark):/i, "");
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("chat:") || lowered.startsWith("group:") || lowered.startsWith("channel:")) {
    return trimmed.slice(trimmed.indexOf(":") + 1).trim() || null;
  }
  if (lowered.startsWith("user:") || lowered.startsWith("dm:") || lowered.startsWith("open_id:")) {
    return trimmed.slice(trimmed.indexOf(":") + 1).trim() || null;
  }
  return trimmed;
}

function resolveReceiveIdType(raw) {
  const trimmed = normalizeText(raw);
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("chat:") || lowered.startsWith("group:") || lowered.startsWith("channel:")) return "chat_id";
  if (lowered.startsWith("open_id:")) return "open_id";
  if (lowered.startsWith("user:") || lowered.startsWith("dm:")) {
    const normalized = trimmed.slice(trimmed.indexOf(":") + 1).trim();
    return normalized.startsWith("ou_") ? "open_id" : "user_id";
  }
  if (trimmed.startsWith("oc_")) return "chat_id";
  if (trimmed.startsWith("ou_")) return "open_id";
  return "user_id";
}

async function getTenantAccessToken(api) {
  const feishu = api.config?.channels?.feishu;
  const appId = normalizeText(feishu?.appId);
  const appSecret = normalizeText(feishu?.appSecret);
  if (!appId || !appSecret) {
    throw new Error("channels.feishu.appId/appSecret are required");
  }

  const domain = normalizeText(feishu?.domain);
  const cacheKey = `${domain}:${appId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) {
    return cached.token;
  }

  const { stdout } = await execFileAsync("/usr/bin/curl", [
    "-sS",
    "-X",
    "POST",
    `${resolveApiBase(domain)}/open-apis/auth/v3/tenant_access_token/internal`,
    "-H",
    "Content-Type: application/json",
    "--data",
    JSON.stringify({ app_id: appId, app_secret: appSecret }),
  ]);

  const data = parseCurlJson(stdout);
  if (data?.code !== 0 || !data?.tenant_access_token) {
    throw new Error(`Feishu token error: ${data?.msg || "unknown error"}`);
  }

  tokenCache.set(cacheKey, {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (typeof data.expire === "number" ? data.expire : 7200) * 1000,
  });

  return data.tenant_access_token;
}

function isMainSession(sessionKey) {
  const normalized = normalizeText(sessionKey).toLowerCase();
  return normalized === "main" || normalized === "agent:main:main" || normalized.endsWith(":main");
}

function isWebchatSession({ channel, sessionKey }) {
  const normalizedChannel = normalizeText(channel).toLowerCase();
  if (normalizedChannel === "webchat") return true;
  const normalizedSessionKey = normalizeText(sessionKey).toLowerCase();
  return normalizedSessionKey.includes("webchat");
}

function isFeishuLoopbackSource({ channel, sessionKey, senderId, originatingChannel, targetTo }) {
  const normalizedChannel = normalizeText(channel).toLowerCase();
  const normalizedOriginatingChannel = normalizeText(originatingChannel).toLowerCase();
  const normalizedSessionKey = normalizeText(sessionKey).toLowerCase();
  const normalizedSenderId = normalizeText(senderId).toLowerCase();
  const normalizedTarget = normalizeText(normalizeFeishuTarget(targetTo)).toLowerCase();

  if (normalizedChannel === "feishu" || normalizedOriginatingChannel === "feishu") return true;
  if (normalizedSessionKey.startsWith("feishu:") || normalizedSessionKey.includes(":feishu:")) return true;
  if (normalizedSessionKey.includes("feishu:direct") || normalizedSessionKey.includes(":direct:")) {
    if (!normalizedTarget) return true;
    if (normalizedSessionKey.includes(normalizedTarget)) return true;
  }
  if (normalizedTarget && normalizedSenderId && normalizedSenderId === normalizedTarget) return true;

  return false;
}

function matchesRule(rule, params) {
  const mode = normalizeText(rule?.source?.match || "");
  const sessionKey = normalizeText(params.sessionKey);
  const webchat = isWebchatSession(params);
  if (mode === "main") {
    if (isMainSession(sessionKey)) return true;
    return !sessionKey && webchat;
  }
  if (mode === "webchat") return webchat && !isMainSession(sessionKey);
  if (mode === "all-webchat") return webchat || isMainSession(sessionKey);
  if (mode === "exact") {
    const keys = Array.isArray(rule?.source?.sessionKeys) ? rule.source.sessionKeys.map((item) => normalizeText(item)) : [];
    return keys.includes(sessionKey);
  }
  return false;
}

function buildMirrorText(role, text) {
  const prefix = role === "user" ? "[WebChat User]" : "[OpenClaw]";
  return `${prefix}\n${text}`;
}

function resolveAssistantMessageText(message) {
  if (!message || message.role !== "assistant") return "";

  const parts = [];
  const seen = new Set();
  const addPart = (value) => {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    parts.push(normalized);
  };

  if (typeof message.content === "string") addPart(message.content);
  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "text") addPart(item.text);
    }
  }

  return parts.join("\n\n");
}

async function sendMirror({ api, logger, target, text, idempotencyKey, role, dryRun }) {
  if (dryRun) {
    logger.info(
      `message-mirror dry-run channel=${target.channel} to=${target.to} role=${role} key=${idempotencyKey} text=${JSON.stringify(text)}`,
    );
    return;
  }

  const token = await getTenantAccessToken(api);
  const normalizedTarget = normalizeFeishuTarget(target.to);
  if (!normalizedTarget) {
    throw new Error(`Invalid Feishu target: ${target.to}`);
  }

  const { stdout } = await execFileAsync("/usr/bin/curl", [
    "-sS",
    "-X",
    "POST",
    `${resolveApiBase(api.config?.channels?.feishu?.domain)}/open-apis/im/v1/messages?receive_id_type=${resolveReceiveIdType(target.to)}`,
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Content-Type: application/json",
    "--data",
    JSON.stringify({
      receive_id: normalizedTarget,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  ]);

  const data = parseCurlJson(stdout);
  if (data?.code !== 0) {
    throw new Error(`Feishu send error: ${data?.msg || "unknown error"}`);
  }

  logger.info(
    `message-mirror sent channel=${target.channel} to=${target.to} role=${role} key=${idempotencyKey} messageId=${data?.data?.message_id || "unknown"}`,
  );
}

export default definePluginEntry({
  id: "message-mirror",
  name: "Message Mirror",
  description: "Mirrors selected WebChat messages to external targets",
  register(api) {
    const logger = api.logger;
    const stateFile = path.join(api.config?.workspaceDir || path.join(process.env.HOME || ".", ".openclaw"), "plugins", STATE_FILE);

    async function mirror({ role, sessionKey, channel, text, dedupeSeed, senderId, originatingChannel }) {
      const normalizedText = normalizeText(text);
      if (!normalizedText) return;

      const { rules, dryRun } = getPluginConfig(api);
      if (rules.length === 0) return;

      const now = Date.now();
      const state = readState(stateFile);
      pruneState(state, now);

      for (const rawRule of rules) {
        if (!rawRule || rawRule.enabled === false) continue;
        if (role === "user" && rawRule.mirrorUser === false) continue;
        if (role === "assistant" && rawRule.mirrorAssistant === false) continue;
        if (normalizeText(rawRule?.target?.channel) !== "feishu") continue;
        if (!matchesRule(rawRule, { channel, sessionKey })) continue;

        const to = normalizeText(rawRule?.target?.to);
        if (!to) continue;
        if (isFeishuLoopbackSource({ channel, sessionKey, senderId, originatingChannel, targetTo: to })) continue;

        const idempotencyKey = `message-mirror:${rawRule.id || "rule"}:${role}:${sha(`${sessionKey}:${dedupeSeed}:${normalizedText}`)}`;
        if (state.seen[idempotencyKey]) continue;

        try {
          await sendMirror({
            api,
            logger,
            target: { channel: "feishu", to },
            text: buildMirrorText(role, normalizedText),
            idempotencyKey,
            role,
            dryRun,
          });

          state.seen[idempotencyKey] = now;
        } catch (error) {
          logger.error(
            `message-mirror failed role=${role} sessionKey=${sessionKey || "<empty>"} to=${to} key=${idempotencyKey}: ${error?.message || error}`,
          );
        }
      }

      writeState(stateFile, state);
    }

    api.on("message_received", async (event, ctx) => {
      const channel = normalizeText(ctx?.channelId);
      const sessionKey = normalizeText(event?.metadata?.sessionKey || event?.metadata?.session_key || event?.metadata?.agentSessionKey || "");
      if (channel !== "webchat") return;
      await mirror({
        role: "user",
        sessionKey,
        channel,
        text: event?.content,
        dedupeSeed: `${event?.timestamp || Date.now()}`,
        senderId: event?.metadata?.senderId,
        originatingChannel: event?.metadata?.originatingChannel,
      });
    });

    api.on("before_message_write", (event, ctx) => {
      const sessionKey = normalizeText(ctx?.sessionKey || event?.sessionKey);
      if (!isMainSession(sessionKey)) return undefined;

      const text = resolveAssistantMessageText(event?.message);
      if (!text) return undefined;

      void mirror({
        role: "assistant",
        sessionKey,
        channel: "webchat",
        text,
        dedupeSeed: `${Date.now()}:${sessionKey}:${text}`,
        originatingChannel: "webchat",
      });

      return undefined;
    });
  },
});
