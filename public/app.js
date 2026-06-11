const form = document.querySelector("#meeting-form");
const statusEl = document.querySelector("#status");
const previewPanel = document.querySelector("#preview-panel");
const editor = document.querySelector("#editor");
const emptyState = document.querySelector("#empty-state");
const publishButton = document.querySelector("#publish-button");
const sampleButton = document.querySelector("#sample-button");
const notionLink = document.querySelector("#notion-link");

const inputs = {
  meetingDate: document.querySelector("#meetingDate"),
  clientName: document.querySelector("#clientName"),
  owner: document.querySelector("#owner"),
  appPassword: document.querySelector("#appPassword"),
  transcript: document.querySelector("#transcript")
};

let minutes = null;

inputs.meetingDate.value = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

function setStatus(message, busy = false) {
  statusEl.textContent = busy ? `${message}...` : message;
}

function headers() {
  const result = { "Content-Type": "application/json" };
  if (inputs.appPassword.value) result["X-App-Password"] = inputs.appPassword.value;
  return result;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청 처리 중 오류가 발생했습니다.");
  if (data.error) throw new Error(data.error);
  return data;
}

function lineArray(value) {
  if (Array.isArray(value)) return value.join("\n");
  return String(value || "");
}

function parseLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function actionText(items) {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => [item.task, item.owner, item.due_date].filter(Boolean).join(" | "))
    .join("\n");
}

function parseActions(value) {
  return parseLines(value).map((line) => {
    const [task, owner, dueDate] = line.split("|").map((part) => part.trim());
    return { task, owner: owner || "", due_date: dueDate || "미정" };
  });
}

function field(key, label, value, small = false) {
  return `
    <label class="field ${small ? "small" : ""}">
      <span class="field-title">${label}</span>
      <textarea data-key="${key}">${value || ""}</textarea>
    </label>
  `;
}

function renderEditor(data) {
  previewPanel.hidden = false;
  emptyState.hidden = true;
  editor.hidden = false;
  editor.innerHTML = `
    ${field("title", "회의명", data.title, true)}
    ${field("summary", "회의 요약", data.summary)}
    ${field("discussion_points", "주요 논의사항", lineArray(data.discussion_points))}
    ${field("decisions", "결정사항", lineArray(data.decisions))}
    ${field("action_items", "액션아이템: 할 일 | 담당자 | 기한", actionText(data.action_items))}
    ${field("risks", "리스크 및 확인사항", lineArray(data.risks))}
    ${field("next_steps", "다음 단계", lineArray(data.next_steps))}
    ${field("keywords", "키워드", lineArray(data.keywords), true)}
    <div class="notice">수정한 내용 그대로 Notion에 업로드됩니다. 액션아이템은 한 줄에 하나씩 적어주세요.</div>
  `;
  publishButton.disabled = false;

  if (window.matchMedia("(max-width: 900px)").matches) {
    previewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function collectMinutes() {
  const next = { ...minutes };
  editor.querySelectorAll("[data-key]").forEach((el) => {
    const key = el.dataset.key;
    if (["discussion_points", "decisions", "risks", "next_steps", "keywords"].includes(key)) {
      next[key] = parseLines(el.value);
    } else if (key === "action_items") {
      next[key] = parseActions(el.value);
    } else {
      next[key] = el.value.trim();
    }
  });

  next.meeting_date = inputs.meetingDate.value;
  next.client_name = inputs.clientName.value.trim();
  next.owner = inputs.owner.value.trim();
  return next;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  publishButton.disabled = true;
  notionLink.hidden = true;

  try {
    setStatus("AI 회의록 생성 중", true);
    const data = await postJson("/api/generate", {
      meetingDate: inputs.meetingDate.value,
      clientName: inputs.clientName.value.trim(),
      owner: inputs.owner.value.trim(),
      transcript: inputs.transcript.value.trim()
    });
    minutes = data.minutes;
    renderEditor(minutes);
    setStatus("검토 대기");
  } catch (error) {
    setStatus("오류");
    alert(error.message);
  }
});

publishButton.addEventListener("click", async () => {
  try {
    setStatus("Notion 업로드 중", true);
    const data = await postJson("/api/publish", {
      minutes: collectMinutes(),
      transcript: inputs.transcript.value.trim()
    });

    notionLink.href = data.notionUrl;
    notionLink.hidden = false;
    setStatus(data.slackSent ? "업로드 및 Slack 알림 완료" : "Notion 업로드 완료");
    if (data.warning) alert(`Notion 업로드는 완료됐지만 Slack 알림은 실패했습니다.\n${data.warning}`);
  } catch (error) {
    setStatus("오류");
    alert(error.message);
  }
});

sampleButton.addEventListener("click", () => {
  inputs.clientName.value = "땡땡거래처";
  inputs.owner.value = "김민수";
  inputs.transcript.value = `오늘 2026년 6월 11일 땡땡거래처와 미팅을 진행했습니다.
참석자는 내부 김민수, 이지은, 거래처 박지훈입니다.
주요 논의는 납품 일정과 견적 조건이었습니다.
거래처는 다음 주 수요일까지 수정 견적서를 요청했습니다.
김민수가 6월 14일까지 견적서를 전달하기로 했습니다.
다음 미팅은 6월 18일에 진행하기로 했습니다.`;
});
