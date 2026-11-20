const $ = (selector) => document.querySelector(selector);

const form = $("#meeting-form");
const reviewScreen = $("#review-screen");
const editor = $("#editor");
const appbarTitle = $("#appbar-title");
const backButton = $("#back-button");
const sampleButton = $("#sample-button");
const prevButton = $("#prev-button");
const publishButton = $("#publish-button");
const generateButton = $("#generate-button");
const charCount = $("#char-count");
const reviewMeta = $("#review-meta");

const inputs = {
  meetingDate: $("#meetingDate"),
  clientName: $("#clientName"),
  owner: $("#owner"),
  appPassword: $("#appPassword"),
  transcript: $("#transcript")
};

let minutes = null;
let busy = false;

inputs.meetingDate.value = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

/* ───────── 공통 유틸 ───────── */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  if (!response.ok) throw new Error(data.error || "요청 처리 중 오류가 발생했어요.");
  if (data.error) throw new Error(data.error);
  return data;
}

let toastTimer = null;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
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

/* ───────── 화면 전환 ───────── */
function showScreen(name) {
  const isReview = name === "review";
  form.hidden = isReview;
  reviewScreen.hidden = !isReview;
  backButton.hidden = !isReview;
  sampleButton.hidden = isReview;
  appbarTitle.textContent = isReview ? "회의록 확인" : "회의록";
  window.scrollTo({ top: 0 });
  // 숨겨진 상태에서는 높이를 잴 수 없으니, 화면이 보인 뒤에 입력창 높이를 맞춘다
  if (isReview) editor.querySelectorAll("textarea").forEach(autoGrow);
}

/* ───────── 확인·수정 화면 ───────── */
function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}

function field(key, label, value, hint = "") {
  return `
    <section class="editor-block">
      <div class="block-head">
        <h3>${label}</h3>
        ${hint ? `<span class="caption">${hint}</span>` : ""}
      </div>
      <textarea data-key="${key}" rows="1" aria-label="${label}">${esc(value)}</textarea>
    </section>
  `;
}

function renderEditor(data) {
  editor.innerHTML = `
    ${field("title", "회의명", data.title)}
    ${field("summary", "회의 요약", data.summary)}
    ${field("discussion_points", "주요 논의사항", lineArray(data.discussion_points), "한 줄에 하나씩")}
    ${field("decisions", "결정사항", lineArray(data.decisions), "한 줄에 하나씩")}
    ${field("action_items", "액션아이템", actionText(data.action_items), "할 일 | 담당자 | 기한")}
    ${field("risks", "리스크 및 확인사항", lineArray(data.risks), "한 줄에 하나씩")}
    ${field("next_steps", "다음 단계", lineArray(data.next_steps), "한 줄에 하나씩")}
    ${field("keywords", "키워드", lineArray(data.keywords), "한 줄에 하나씩")}
    <p class="notice">고친 내용 그대로 Notion에 올라가요. 원문은 Notion 페이지 맨 아래에 함께 저장돼요.</p>
  `;
  editor.querySelectorAll("textarea").forEach((el) => {
    el.addEventListener("input", () => autoGrow(el));
  });

  reviewMeta.textContent = [inputs.clientName.value.trim(), inputs.owner.value.trim(), inputs.meetingDate.value]
    .filter(Boolean)
    .join(" · ");
}

window.addEventListener("resize", () => {
  if (!reviewScreen.hidden) editor.querySelectorAll("textarea").forEach(autoGrow);
});

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

/* ───────── 진행 시트: 원형 진행률 + 단계 표시 ─────────
   서버 호출은 한 번에 끝나서 실제 진행률을 알 수 없으므로,
   응답을 기다리는 동안 92%까지 천천히 차오르게 하고
   응답이 오면 100%로 마무리한다. */
const RING_LENGTH = 2 * Math.PI * 60;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ICON_CHECK =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.3l2.4 2.4 4.6-5" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_X =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/></svg>';
const ICON_DASH =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 6h6" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/></svg>';
const BIG_CHECK =
  '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true"><path d="M14 29.5l9.5 9.5L42 18" stroke="#03b26c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BIG_ALERT =
  '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true"><path d="M28 14v18" stroke="#f04452" stroke-width="5" stroke-linecap="round"/><circle cx="28" cy="42" r="3" fill="#f04452"/></svg>';

const sheetEl = $("#sheet");
const ringEl = $("#ring");
const ringBar = $("#ring-bar");
const ringPct = $("#ring-pct");
const ringIcon = $("#ring-icon");
const stepsEl = $("#steps");
const sheetTitle = $("#sheet-title");
const sheetDesc = $("#sheet-desc");
const sheetActions = $("#sheet-actions");

const progress = { value: 0, cap: 92, rate: 0.015, timer: null, steps: [], failedIndex: -1 };

function setRing(value) {
  progress.value = value;
  ringBar.style.strokeDashoffset = String(RING_LENGTH * (1 - value / 100));
  ringPct.textContent = String(Math.round(value));
}

function setStepState(index, state) {
  const li = stepsEl.children[index];
  if (!li || li.dataset.state === state) return;
  li.dataset.state = state;
  const dot = li.querySelector(".step-dot");
  dot.innerHTML = { done: ICON_CHECK, error: ICON_X, skip: ICON_DASH }[state] || "";
}

function updateSteps() {
  let activeFound = false;
  progress.steps.forEach((step, index) => {
    if (index === progress.failedIndex) return;
    if (progress.value >= step.until) {
      setStepState(index, "done");
    } else if (!activeFound) {
      setStepState(index, "active");
      activeFound = true;
    } else {
      setStepState(index, "wait");
    }
  });
}

function tick() {
  const gap = progress.cap - progress.value;
  const next = progress.value + Math.max(gap * progress.rate, 0.05);
  setRing(Math.min(next, progress.cap));
  updateSteps();
}

function tweenTo(target, duration) {
  return new Promise((resolve) => {
    const from = progress.value;
    const ms = REDUCED_MOTION ? 0 : duration;
    if (!ms) {
      setRing(target);
      updateSteps();
      resolve();
      return;
    }
    const start = performance.now();
    function frame(now) {
      const k = Math.min((now - start) / ms, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      setRing(from + (target - from) * eased);
      updateSteps();
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function openSheet({ title, desc, steps, rate }) {
  clearInterval(progress.timer);
  progress.steps = steps;
  progress.rate = rate;
  progress.failedIndex = -1;
  ringEl.dataset.state = "run";
  ringIcon.innerHTML = "";
  sheetTitle.textContent = title;
  sheetDesc.textContent = desc;
  sheetActions.innerHTML = "";
  stepsEl.innerHTML = steps
    .map(
      (step) =>
        `<li class="step" data-state="wait"><span class="step-dot"></span><span class="step-label">${esc(step.label)}</span></li>`
    )
    .join("");
  setRing(0);
  updateSteps();
  $("#toast").classList.remove("show");
  sheetEl.hidden = false;
  document.body.classList.add("no-scroll");
  progress.timer = setInterval(tick, 120);
}

function closeSheet() {
  clearInterval(progress.timer);
  sheetEl.hidden = true;
  document.body.classList.remove("no-scroll");
}

async function succeedSheet({ title, desc, labels = {}, skipped = [], actions = [], hold = 0 }) {
  clearInterval(progress.timer);
  await tweenTo(100, 420);
  Object.entries(labels).forEach(([index, label]) => {
    stepsEl.children[index].querySelector(".step-label").textContent = label;
  });
  skipped.forEach((index) => setStepState(index, "skip"));
  ringEl.dataset.state = "done";
  ringIcon.innerHTML = BIG_CHECK;
  sheetTitle.textContent = title;
  sheetDesc.textContent = desc || "";
  renderActions(actions);
  if (hold) await new Promise((resolve) => setTimeout(resolve, hold));
}

function failSheet(message, retry) {
  clearInterval(progress.timer);
  const active = [...stepsEl.children].findIndex((li) => li.dataset.state === "active");
  progress.failedIndex = active >= 0 ? active : 0;
  setStepState(progress.failedIndex, "error");
  const failLabel = progress.steps[progress.failedIndex]?.failLabel;
  if (failLabel) stepsEl.children[progress.failedIndex].querySelector(".step-label").textContent = failLabel;
  ringEl.dataset.state = "error";
  ringIcon.innerHTML = BIG_ALERT;
  sheetTitle.textContent = "문제가 생겼어요";
  sheetDesc.textContent = message || "잠시 후 다시 시도해 주세요.";
  renderActions([
    { label: "닫기", kind: "secondary", onClick: closeSheet },
    {
      label: "다시 시도",
      kind: "primary",
      onClick: () => {
        closeSheet();
        retry();
      }
    }
  ]);
}

function renderActions(actions) {
  sheetActions.innerHTML = "";
  actions.forEach((action) => {
    const el = document.createElement(action.href ? "a" : "button");
    el.className = `btn btn-${action.kind || "secondary"}`;
    el.textContent = action.label;
    if (action.href) {
      el.href = action.href;
      el.target = "_blank";
      el.rel = "noreferrer";
    } else {
      el.type = "button";
    }
    if (action.onClick) el.addEventListener("click", action.onClick);
    sheetActions.appendChild(el);
  });
}

/* ───────── 동작: 회의록 만들기 ───────── */
// 회의록 생성은 10~20초 걸리므로 천천히 차오르게(rate 작게) 한다
const GENERATE_STEPS = [
  { label: "원문을 보내고 있어요", failLabel: "원문을 보내지 못했어요", until: 10 },
  { label: "AI가 회의록을 쓰고 있어요", failLabel: "회의록을 만들지 못했어요", until: 85 },
  { label: "내용을 정리하고 있어요", failLabel: "내용을 정리하지 못했어요", until: 100 }
];

async function generateMinutes() {
  if (busy) return;
  busy = true;
  openSheet({
    title: "회의록을 만들고 있어요",
    desc: "보통 10~20초 걸려요",
    steps: GENERATE_STEPS,
    rate: 0.014
  });

  try {
    const data = await postJson("/api/generate", {
      meetingDate: inputs.meetingDate.value,
      clientName: inputs.clientName.value.trim(),
      owner: inputs.owner.value.trim(),
      transcript: inputs.transcript.value.trim()
    });
    minutes = data.minutes;
    renderEditor(minutes);
    await succeedSheet({ title: "회의록이 만들어졌어요", desc: "", hold: 650 });
    closeSheet();
    showScreen("review");
  } catch (error) {
    failSheet(error.message, generateMinutes);
  } finally {
    busy = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!inputs.clientName.value.trim() || !inputs.owner.value.trim()) {
    toast("거래처명과 작성 담당자를 입력해 주세요");
    (inputs.clientName.value.trim() ? inputs.owner : inputs.clientName).focus();
    return;
  }
  if (inputs.transcript.value.trim().length < 20) {
    toast("클로바노트 원문을 20자 이상 붙여넣어 주세요");
    inputs.transcript.focus();
    return;
  }
  generateMinutes();
});

/* ───────── 동작: Notion 업로드 + Slack 알림 ───────── */
// Notion·Slack 업로드는 보통 몇 초 안에 끝나므로 빠르게 차오르게(rate 크게) 한다
const PUBLISH_STEPS = [
  { label: "Notion에 페이지를 만들고 있어요", failLabel: "Notion 페이지를 만들지 못했어요", until: 62 },
  { label: "Slack으로 알림을 보내고 있어요", failLabel: "Slack 알림을 보내지 못했어요", until: 100 }
];

async function publishMinutes() {
  if (busy) return;
  busy = true;
  openSheet({
    title: "Notion에 올리고 있어요",
    desc: "창을 닫지 말고 잠시만 기다려 주세요",
    steps: PUBLISH_STEPS,
    rate: 0.045
  });

  try {
    const data = await postJson("/api/publish", {
      minutes: collectMinutes(),
      transcript: inputs.transcript.value.trim()
    });

    let desc = "Slack 알림도 보냈어요";
    const labels = { 1: "Slack 알림을 보냈어요" };
    const skipped = [];
    if (!data.slackSent) {
      skipped.push(1);
      labels[1] = data.warning ? "Slack 알림은 보내지 못했어요" : "Slack 알림은 건너뛰었어요";
      desc = data.warning ? `Notion에는 올렸지만 Slack 알림은 실패했어요. ${data.warning}` : "Slack이 연결되어 있지 않아 알림은 보내지 않았어요";
    }

    await succeedSheet({
      title: "Notion에 올렸어요",
      desc,
      labels: { 0: "Notion 페이지를 만들었어요", ...labels },
      skipped,
      actions: [
        { label: "Notion에서 열기", kind: "primary", href: data.notionUrl },
        { label: "새 회의록 쓰기", kind: "secondary", onClick: resetForNext }
      ]
    });
  } catch (error) {
    failSheet(error.message, publishMinutes);
  } finally {
    busy = false;
  }
}

function resetForNext() {
  closeSheet();
  minutes = null;
  inputs.clientName.value = "";
  inputs.transcript.value = "";
  updateCount();
  showScreen("input");
}

/* ───────── 이벤트 연결 ───────── */
publishButton.addEventListener("click", publishMinutes);

function backToInput() {
  if (minutes) minutes = collectMinutes();
  showScreen("input");
}
backButton.addEventListener("click", backToInput);
prevButton.addEventListener("click", backToInput);

function updateCount() {
  charCount.textContent = `${inputs.transcript.value.length.toLocaleString("ko-KR")}자`;
}
inputs.transcript.addEventListener("input", updateCount);

sampleButton.addEventListener("click", () => {
  inputs.clientName.value = "땡땡거래처";
  inputs.owner.value = "김민수";
  inputs.transcript.value = `오늘 2026년 6월 11일 땡땡거래처와 미팅을 진행했습니다.
참석자는 내부 김민수, 이지은, 거래처 박지훈입니다.
주요 논의는 납품 일정과 견적 조건이었습니다.
거래처는 다음 주 수요일까지 수정 견적서를 요청했습니다.
김민수가 6월 14일까지 견적서를 전달하기로 했습니다.
다음 미팅은 6월 18일에 진행하기로 했습니다.`;
  updateCount();
  toast("샘플을 넣었어요");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !sheetEl.hidden && !busy) closeSheet();
});

updateCount();
