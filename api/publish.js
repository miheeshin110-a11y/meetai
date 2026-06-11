const {
  allowCors,
  requireMethod,
  requirePassword,
  readJson,
  sendJson,
  requireEnv,
  normalizeNotionId,
  richText,
  buildNotionChildren,
  notionFetch
} = require("./_utils");

function propText(value, type) {
  if (type !== "rich_text") return null;
  return { rich_text: richText(value) };
}

function keywordProperty(keywords, type) {
  const values = Array.isArray(keywords) ? keywords : String(keywords || "").split(",");
  if (type !== "multi_select") {
    return propText(values.map((name) => String(name).trim()).filter(Boolean).join(", "), type);
  }

  return {
    multi_select: values
      .map((name) => String(name).trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((name) => ({ name: name.slice(0, 100) }))
  };
}

async function notifySlack(minutes, notionUrl) {
  if (!process.env.SLACK_WEBHOOK_URL) return null;

  const actionCount = Array.isArray(minutes.action_items) ? minutes.action_items.length : 0;
  const text = `${minutes.title} 회의록이 업로드되었습니다.`;
  const payload = {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "회의록 업로드 완료" } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${minutes.title}*\n담당자: ${minutes.owner || "-"}\n거래처: ${minutes.client_name || "-"}`
        }
      },
      { type: "section", text: { type: "mrkdwn", text: `*요약*\n${minutes.summary || "-"}` } },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `액션아이템 ${actionCount}개 · <${notionUrl}|Notion에서 보기>` }]
      }
    ]
  };

  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Slack 알림 오류 (${response.status})`);
  }
  return true;
}

function setProperty(properties, schema, name, value) {
  const property = schema[name];
  if (!property) return;
  const type = property.type;

  if (type === "title") {
    properties[name] = { title: richText(value) };
  } else if (type === "date") {
    properties[name] = value ? { date: { start: value } } : { date: null };
  } else if (type === "rich_text") {
    properties[name] = propText(value, type);
  } else if (type === "multi_select") {
    properties[name] = keywordProperty(value, type);
  } else if (type === "number" && value !== undefined && value !== "") {
    const number = Number(value);
    if (!Number.isNaN(number)) properties[name] = { number };
  }
}

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (!requireMethod(req, res)) return;
  if (!requirePassword(req, res)) return;

  try {
    requireEnv(["NOTION_TOKEN", "NOTION_DATABASE_ID"]);
    const body = await readJson(req);
    const minutes = body.minutes || {};
    const transcript = body.transcript || "";
    if (!minutes.title) {
      return sendJson(res, 400, { error: "회의록 제목이 없습니다. 먼저 AI 회의록을 생성해주세요." });
    }

    const databaseId = normalizeNotionId(process.env.NOTION_DATABASE_ID);
    const database = await notionFetch(`/databases/${databaseId}`);
    const schema = database.properties || {};
    const titleName = schema["회의명"]?.type === "title"
      ? "회의명"
      : Object.entries(schema).find(([, property]) => property.type === "title")?.[0];

    const properties = {};
    if (titleName) setProperty(properties, schema, titleName, minutes.title);
    setProperty(properties, schema, "날짜", minutes.meeting_date);
    setProperty(properties, schema, "거래처명", minutes.client_name);
    setProperty(properties, schema, "작성 담당자", minutes.owner);
    setProperty(properties, schema, "키워드", minutes.keywords);

    const notionPage = await notionFetch("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        icon: { type: "emoji", emoji: "📋" },
        properties,
        children: buildNotionChildren(minutes)
      })
    });

    let slackSent = false;
    try {
      slackSent = Boolean(await notifySlack(minutes, notionPage.url));
    } catch (slackError) {
      return sendJson(res, 200, {
        notionUrl: notionPage.url,
        slackSent: false,
        warning: slackError.message
      });
    }

    sendJson(res, 200, { notionUrl: notionPage.url, slackSent });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "업로드 중 오류가 발생했습니다." });
  }
};
