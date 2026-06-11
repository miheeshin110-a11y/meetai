const {
  allowCors,
  requirePassword,
  sendJson,
  cleanEnvValue
} = require("./_utils");

function keyHint(value) {
  if (!value) return "empty";
  return {
    startsWith: value.slice(0, 16),
    endsWith: value.slice(-6),
    length: value.length,
    looksLikeAnthropicKey: value.startsWith("sk-ant-")
  };
}

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (!["GET", "POST"].includes(req.method)) {
    return sendJson(res, 405, { error: "GET 또는 POST 요청만 허용됩니다." });
  }
  const configuredPassword = cleanEnvValue("APP_PASSWORD");
  const url = new URL(req.url, "https://meetai.local");
  const queryPassword = url.searchParams.get("password");
  if (configuredPassword && queryPassword !== configuredPassword && !requirePassword(req, res)) return;

  sendJson(res, 200, {
    version: "v6-debug-env",
    anthropicKey: keyHint(cleanEnvValue("ANTHROPIC_API_KEY")),
    anthropicModel: cleanEnvValue("ANTHROPIC_MODEL") || null,
    hasNotionToken: Boolean(cleanEnvValue("NOTION_TOKEN")),
    hasNotionDatabaseId: Boolean(cleanEnvValue("NOTION_DATABASE_ID")),
    hasSlackWebhook: Boolean(cleanEnvValue("SLACK_WEBHOOK_URL")),
    hasAppPassword: Boolean(cleanEnvValue("APP_PASSWORD"))
  });
};
