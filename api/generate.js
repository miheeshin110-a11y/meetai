const {
  allowCors,
  requireMethod,
  readJson,
  sendJson,
  requireEnv,
  cleanEnvValue
} = require("./_utils");

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
  return `${value.slice(0, 16)}...${value.slice(-6)} (length ${value.length})`;
}

function resolveAnthropicModel(value) {
  const model = String(value || "").trim();
  const aliases = {
    "claude-sonnet-4-20250514": "claude-sonnet-4-6",
    "claude-sonnet-4-5": "claude-sonnet-4-6"
  };
  return aliases[model] || model || "claude-sonnet-4-6";
}

const minutesTool = {
  name: "create_meeting_minutes",
  description: "Create structured Korean meeting minutes from a ClovaNote transcript.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "meeting_date",
      "client_name",
      "owner",
      "attendees",
      "summary",
      "discussion_points",
      "decisions",
      "action_items",
      "risks",
      "next_steps",
      "keywords"
    ],
    properties: {
      title: { type: "string" },
      meeting_date: { type: "string" },
      client_name: { type: "string" },
      owner: { type: "string" },
      attendees: { type: "array", minItems: 1, items: { type: "string" } },
      summary: { type: "string" },
      discussion_points: { type: "array", minItems: 1, items: { type: "string" } },
      decisions: { type: "array", minItems: 1, items: { type: "string" } },
      action_items: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["task", "owner", "due_date"],
          properties: {
            task: { type: "string" },
            owner: { type: "string" },
            due_date: { type: "string" }
          }
        }
      },
      risks: { type: "array", minItems: 1, items: { type: "string" } },
      next_steps: { type: "array", minItems: 1, items: { type: "string" } },
      keywords: { type: "array", minItems: 1, items: { type: "string" } }
    }
  }
};

function normalizeMinutes(minutes, fallback) {
  const date = minutes.meeting_date || fallback.meetingDate;
  const client = minutes.client_name || fallback.clientName || "미상";
  const list = (value, fallbackItem) => {
    if (Array.isArray(value) && value.some((item) => String(item || "").trim())) {
      return value.filter((item) => String(item || "").trim());
    }
    return [fallbackItem];
  };
  const actions = Array.isArray(minutes.action_items)
    ? minutes.action_items.filter((item) => item && String(item.task || "").trim())
    : [];

  return {
    title: minutes.title || `${date} ${client} 미팅`,
    meeting_date: date,
    client_name: client,
    owner: minutes.owner || fallback.owner || "미상",
    attendees: list(minutes.attendees, "참석자 확인 필요"),
    summary: minutes.summary || "요약 없음",
    discussion_points: list(minutes.discussion_points, "주요 논의사항 확인 필요"),
    decisions: list(minutes.decisions, "원문에 명시된 결정사항 없음"),
    action_items: actions.length
      ? actions.map((item) => ({
          task: item.task || "후속 조치 확인",
          owner: item.owner || "담당자 확인 필요",
          due_date: item.due_date || "미정"
        }))
      : [{ task: "원문에 명시된 액션아이템 없음", owner: "해당 없음", due_date: "해당 없음" }],
    risks: list(minutes.risks, "원문에 명시된 특이 리스크 없음"),
    next_steps: list(minutes.next_steps, "원문에 명시된 다음 단계 없음"),
    keywords: list(minutes.keywords, client)
  };
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

    const prompt = `클로바노트 원문을 한국어 회의록으로 정리해 주세요.

작성 기준:
- 회의명은 "YYYY년 M월 D일 거래처명 미팅" 형식으로 작성
- 요약은 3~5문장
- 결정사항과 액션아이템을 명확히 분리
- 기한이 없으면 due_date는 "미정"
- 원문에 없는 내용은 추측하지 않음
- 모든 배열 필드는 반드시 최소 1개 이상 채움
- 결정사항이 원문에 없으면 "원문에 명시된 결정사항 없음" 입력
- 리스크가 원문에 없으면 "원문에 명시된 특이 리스크 없음" 입력
- 액션아이템이 원문에 없으면 task는 "원문에 명시된 액션아이템 없음", owner는 "해당 없음", due_date는 "해당 없음" 입력
- 다음 단계가 원문에 없으면 "원문에 명시된 다음 단계 없음" 입력
- 다음 단계가 원문에 있으면 반드시 next_steps에 반영

입력 정보:
- 미팅일: ${meetingDate}
- 거래처명: ${clientName || "원문에서 확인"}
- 작성 담당자: ${owner || "원문에서 확인"}

클로바노트 원문:
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
        max_tokens: 2200,
        temperature: 0.1,
        tools: [minutesTool],
        tool_choice: { type: "tool", name: "create_meeting_minutes" },
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error?.message || `Claude API 오류 (${response.status})`;
      if (response.status === 401 || /token|auth|api key/i.test(message)) {
        throw new Error(`${message} / Vercel에 적용된 ANTHROPIC_API_KEY: ${keyHint(anthropicApiKey)}`);
      }
      throw new Error(message);
    }

    const toolUse = data.content?.find((part) => part.type === "tool_use" && part.name === "create_meeting_minutes");
    if (!toolUse?.input) {
      throw new Error("AI가 회의록 구조를 반환하지 못했습니다. 원문을 조금 줄여 다시 시도해주세요.");
    }

    const minutes = normalizeMinutes(toolUse.input, { meetingDate, clientName, owner });
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
