# MeetAI

클로바노트 회의 텍스트를 붙여넣으면 AI가 회의록을 생성하고, Notion DB에 업로드한 뒤 Slack으로 알림을 보내는 MVP 앱입니다.

## 1. Notion DB 컬럼

Notion 회의록 DB는 아래 컬럼을 권장합니다.

| 컬럼명 | 타입 |
| --- | --- |
| 회의명 | 제목 |
| 날짜 | 날짜 |
| 거래처명 | 텍스트 |
| 작성 담당자 | 텍스트 |
| 키워드 | 텍스트 또는 다중 선택 |
| 순번 | 숫자 |

`회의명`은 Notion의 제목 속성이어야 합니다. `순번`은 앱에서 필수로 쓰지 않습니다.

## 2. 로컬 실행

`.env.example`을 참고해서 `.env` 파일을 만들고 값을 채웁니다.

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
NOTION_TOKEN=ntn_...
NOTION_DATABASE_ID=...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
APP_PASSWORD=원하는_내부_비밀번호
```

실행:

```bash
npm run dev
```

브라우저에서 엽니다.

```text
http://localhost:3000
```

## 3. Vercel 배포

Vercel 프로젝트를 만들고 아래 환경변수를 등록합니다.

```text
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
NOTION_TOKEN
NOTION_DATABASE_ID
SLACK_WEBHOOK_URL
APP_PASSWORD
```

배포 후 앱 화면에서 클로바노트 원문을 붙여넣고 `AI 회의록 생성`을 누른 뒤, 결과를 검토하고 `Notion 업로드 + Slack 알림`을 누르면 됩니다.

## 4. 주의사항

- API Key, Notion Token, Slack Webhook URL은 코드에 직접 넣지 않습니다.
- 개인 Claude API Key는 테스트용으로만 쓰고, 운영 전 회사 계정 키로 교체하는 것을 권장합니다.
- Notion Integration이 회의록 DB에 연결되어 있어야 업로드됩니다.
