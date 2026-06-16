const {
  allowCors,
  requireMethod,
  readJson,
  sendJson,
  requireEnv,
  cleanEnvValue
} = require("./_utils");

function stripCodeFence(text) {
  return String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function todayKorea() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function keyHint(value) {
  if (!value) return "empty";
  const start = value.slice(0, 16);
  const end = value.slice(-6);
  return `${start}...${end} (length ${value.length})`;
}

function resolveAnthropicModel(value) {
  const model = String(value || "").trim();
  const aliases = {
    "claude-sonnet-4-20250514": "claude-sonnet-4-6",
    "claude-sonnet-4-5": "claude-sonnet-4-6"
  };
  return aliases[model] || model || "claude-sonnet-4-6";
}

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (!requireMethod(req, res)) return;

  let anthropicApiKey = "";
  try {
    requireEnv(["ANTHROPIC_API_KEY"]);
    anthropicApiKey = cleanEnvValue("ANTHROPIC_API_KEY");
    const anthropicModel = resolveAnthropicModel(cleanEnvValue("ANTHROPIC_MODEL"));
    if (!anthropicApiKey.startsWith("sk-ant-")) {
      return sendJson(res, 400, {
        error: "ANTHROPIC_API_KEY 값이 API Key 형식이 아닙니다. Vercel Value 칸에는 sk-ant-... 로 시작하는 키만 넣어주세요."
      });
    }

    const body = await readJson(req);
    const transcript = String(body.transcript || "").trim();
    if (transcript.length < 20) {
      return sendJson(res, 400, { error: "클로바노트 원문을 20자 이상 입력해주세요." });
    }

    const meetingDate = body.meetingDate || todayKorea();
    const clientName = body.clientName || "";
    const owner = body.owner || "";

    const prompt = `너는 회사 미팅 회의록을 정리하는 운영 담당자다.
아래 클로바노트 원문을 바탕으로 한국어 회의록 JSON만 생성해라.
마크다운 코드블록 없이 순수 JSON만 반환해라.

반드시 포함할 필드:
{
  "title": "YYYY년 M월 D일 거래처명 미팅",
  "meeting_date": "YYYY-MM-DD",
  "client_name": "거래처명",
  "owner": "작성 담당자",
  "attendees": ["참석자"],
  "summary": "3~5문장 요약",
  "discussion_points": ["주요 논의사항"],
  "decisions": ["결정사항"],
  "action_items": [{"task":"할 일","owner":"담당자","due_date":"YYYY-MM-DD 또는 미정"}],
  "risks": ["리스크 또는 확인사항"],
  "next_steps": ["다음 단계"],
  "keywords": ["키워드"]
}

입력 정보:
- 미팅일: ${meetingDate}
- 거래처명: ${clientName || "원문에서 추정"}
- 작성 담당자: ${owner || "원문에서 추정"}

원문:
${transcript}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 1800,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error?.message || `Claude API 오류 (${response.status})`;
      if (response.status === 401 || /token|auth|api key/i.test(message)) {
        throw new Error(
          `${message} / Vercel에 적용된 ANTHROPIC_API_KEY: ${keyHint(anthropicApiKey)}`
        );
      }
      throw new Error(message);
    }

    const text = data.content?.map((part) => part.text || "").join("").trim();
    const minutes = JSON.parse(stripCodeFence(text));
    sendJson(res, 200, { minutes });
  } catch (error) {
    const message = error.message || "회의록 생성 중 오류가 발생했습니다.";
    const needsHint = /token|auth|api key|credential/i.test(message) && !message.includes("Vercel에 적용된");
    sendJson(res, 500, {
      error: needsHint
        ? `${message} / Vercel에 적용된 ANTHROPIC_API_KEY: ${keyHint(anthropicApiKey)}`
        : message
    });
  }
};
