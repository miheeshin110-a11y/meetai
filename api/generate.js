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
  description: "Create detailed but well-organized Korean meeting minutes from a ClovaNote transcript.",
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
      title: { type: "string", maxLength: 100 },
      meeting_date: { type: "string", maxLength: 10 },
      client_name: { type: "string", maxLength: 50 },
      owner: { type: "string", maxLength: 40 },
      attendees: {
        type: "array",
        minItems: 1,
        maxItems: 15,
        items: { type: "string", maxLength: 40 }
      },
      summary: { type: "string", maxLength: 520 },
      discussion_points: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: { type: "string", maxLength: 180 }
      },
      decisions: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string", maxLength: 160 }
      },
      action_items: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["task", "owner", "due_date"],
          properties: {
            task: { type: "string", maxLength: 160 },
            owner: { type: "string", maxLength: 50 },
            due_date: { type: "string", maxLength: 30 }
          }
        }
      },
      risks: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: { type: "string", maxLength: 160 }
      },
      next_steps: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string", maxLength: 160 }
      },
      keywords: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: { type: "string", maxLength: 30 }
      }
    }
  }
};

function compact(text, maxLength) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function compactList(value, fallbackItem, maxItems, maxLength) {
  const items = Array.isArray(value)
    ? value.map((item) => compact(item, maxLength)).filter(Boolean)
    : [];
  return (items.length ? items : [fallbackItem]).slice(0, maxItems);
}

function normalizeMinutes(minutes, fallback) {
  const date = minutes.meeting_date || fallback.meetingDate;
  const client = minutes.client_name || fallback.clientName || "미상";
  const actions = Array.isArray(minutes.action_items)
    ? minutes.action_items.filter((item) => item && String(item.task || "").trim())
    : [];

  return {
    title: compact(minutes.title || `${date} ${client} 미팅`, 100),
    meeting_date: date,
    client_name: compact(client, 50),
    owner: compact(minutes.owner || fallback.owner || "미상", 40),
    attendees: compactList(minutes.attendees, "참석자 확인 필요", 15, 40),
    summary: compact(minutes.summary || "요약 없음", 520),
    discussion_points: compactList(minutes.discussion_points, "주요 논의사항 확인 필요", 12, 180),
    decisions: compactList(minutes.decisions, "원문에 명시된 결정사항 없음", 8, 160),
    action_items: actions.length
      ? actions.slice(0, 12).map((item) => ({
          task: compact(item.task || "후속 조치 확인", 160),
          owner: compact(item.owner || "담당자 확인 필요", 50),
          due_date: compact(item.due_date || "미정", 30)
        }))
      : [{ task: "원문에 명시된 액션아이템 없음", owner: "해당 없음", due_date: "해당 없음" }],
    risks: compactList(minutes.risks, "원문에 명시된 특이 리스크 없음", 6, 160),
    next_steps: compactList(minutes.next_steps, "원문에 명시된 다음 단계 없음", 8, 160),
    keywords: compactList(minutes.keywords, client, 6, 30)
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

목표:
- 짧게 줄이는 것이 아니라, 중요한 내용을 충분히 담되 읽기 좋게 정리합니다.
- 원문 전체를 그대로 옮기지 말고, 중복 발언과 말버릇은 제거합니다.
- 상품명, 수량, 일정, 금액, 담당자, 이슈 원인은 가능하면 보존합니다.
- 각 항목은 한 문장 안에 핵심 배경과 의미가 드러나게 작성합니다.
- 너무 긴 문단은 피하고, 항목별 bullet로 정돈합니다.

작성 기준:
- summary: 회의 전체 맥락과 결론을 3~5문장으로 작성
- discussion_points: 논의된 이슈를 주제별로 6~12개 정리
- decisions: 실제로 확정된 내용만 작성. 논의만 된 내용은 넣지 않음
- action_items: 누가/무엇을/언제까지 해야 하는지 확인 가능한 항목만 작성
- risks: 일정, 재고, 비용, 품질, 커뮤니케이션 리스크가 있으면 작성
- next_steps: 다음 회의, 확인 예정, 추가 발주, 공유 필요 등 후속 흐름 작성
- keywords: 나중에 검색할 핵심어 3~6개

없는 항목 처리:
- 결정사항이 원문에 없으면 "원문에 명시된 결정사항 없음"
- 액션아이템이 원문에 없으면 task는 "원문에 명시된 액션아이템 없음", owner/due_date는 "해당 없음"
- 리스크가 원문에 없으면 "원문에 명시된 특이 리스크 없음"
- 다음 단계가 원문에 없으면 "원문에 명시된 다음 단계 없음"

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
        max_tokens: 2600,
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
