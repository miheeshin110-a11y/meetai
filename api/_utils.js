const NOTION_VERSION = "2022-06-28";

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON 형식이 올바르지 않습니다."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function allowCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Password");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function requireMethod(req, res, method = "POST") {
  if (req.method !== method) {
    sendJson(res, 405, { error: `${method} 요청만 허용됩니다.` });
    return false;
  }
  return true;
}

function requirePassword(req, res) {
  const configured = process.env.APP_PASSWORD;
  if (!configured) return true;

  const provided = req.headers["x-app-password"];
  if (provided !== configured) {
    sendJson(res, 401, { error: "앱 비밀번호가 올바르지 않습니다." });
    return false;
  }
  return true;
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`환경변수가 없습니다: ${missing.join(", ")}`);
  }
}

function normalizeNotionId(value = "") {
  const cleaned = String(value).trim();
  const match = cleaned.match(/[0-9a-fA-F]{32}/);
  return match ? match[0] : cleaned.replace(/-/g, "");
}

function richText(text) {
  const value = String(text || "").slice(0, 1900);
  return [{ type: "text", text: { content: value || "-" } }];
}

function chunkText(text, size = 1800) {
  const source = String(text || "");
  const chunks = [];
  for (let i = 0; i < source.length; i += size) {
    chunks.push(source.slice(i, i + size));
  }
  return chunks.length ? chunks : ["-"];
}

function textBlock(type, text) {
  return { object: "block", type, [type]: { rich_text: richText(text) } };
}

function bullets(items, fallback) {
  const values = Array.isArray(items) && items.length ? items : [fallback];
  return values.slice(0, 20).map((item) => textBlock("bulleted_list_item", item));
}

function actionBlocks(items) {
  const values = Array.isArray(items) && items.length ? items : [];
  if (!values.length) return [textBlock("to_do", "후속 액션아이템 없음")];

  return values.slice(0, 20).map((item) => {
    const owner = item.owner ? `${item.owner} / ` : "";
    const due = item.due_date ? ` / ${item.due_date}` : "";
    return {
      object: "block",
      type: "to_do",
      to_do: {
        rich_text: richText(`${owner}${item.task || item}${due}`),
        checked: false
      }
    };
  });
}

function buildNotionChildren(minutes, transcript) {
  const children = [
    textBlock("heading_2", "회의 요약"),
    textBlock("paragraph", minutes.summary),
    textBlock("heading_2", "주요 논의사항"),
    ...bullets(minutes.discussion_points, "주요 논의사항 없음"),
    textBlock("heading_2", "결정사항"),
    ...bullets(minutes.decisions, "결정사항 없음"),
    textBlock("heading_2", "액션아이템"),
    ...actionBlocks(minutes.action_items),
    textBlock("heading_2", "리스크 및 확인사항"),
    ...bullets(minutes.risks, "특이 리스크 없음"),
    textBlock("heading_2", "다음 단계"),
    ...bullets(minutes.next_steps, "다음 단계 없음"),
    {
      object: "block",
      type: "toggle",
      toggle: {
        rich_text: richText("클로바노트 원문"),
        children: chunkText(transcript).slice(0, 80).map((part) => textBlock("paragraph", part))
      }
    }
  ];

  return children.slice(0, 95);
}

async function notionFetch(path, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Notion API 오류 (${response.status})`);
  }
  return data;
}

module.exports = {
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
};
