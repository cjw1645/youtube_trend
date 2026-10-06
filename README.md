# 유튜브 트렌드 AI 대시보드

한국 인기 영상·검색 결과를 탐색하고 현재 화면의 영상 정보를 근거로 Gemini에게 콘텐츠 분석을 묻는 서비스입니다.

[서비스](https://youtube-trend-orpin.vercel.app) · [저장소](https://github.com/cjw1645/youtube_trend)

영상 검색·카테고리·조회수/최신순 정렬, 상세 정보, 관심 영상 저장을 지원합니다. React·TypeScript·Tailwind CSS·Vercel Functions·YouTube Data API v3·Gemini를 사용합니다.

## 로컬 실행

Node.js 24 이상과 Vercel CLI를 사용합니다.

```powershell
npm ci
vercel link
vercel dev --listen 3000
```

이미 연결된 저장소에서는 `vercel link`를 생략합니다. 프론트와 `/api`는 같은 주소에서 제공됩니다. 배포 빌드는 `npm run build`입니다.

## Key 발급·설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만들고 YouTube Data API v3를 사용 설정한 뒤 Key를 발급합니다. API 제한은 YouTube Data API v3로 설정합니다. 서버 호출이므로 HTTP 리퍼러 제한은 사용하지 않습니다.
2. [Google AI Studio](https://aistudio.google.com/apikey)에서 Gemini Key를 발급하고 프로젝트의 무료 사용 가능 여부·할당량을 확인합니다.
3. 저장소 루트의 `.env.local`에 `YOUTUBE_API_KEY`, `GEMINI_API_KEY`를 직접 설정합니다. [환경변수 예제](.env.example)는 이름만 포함합니다.
4. Vercel Settings → Environment Variables에도 두 이름을 Production과 사용할 Preview에 등록하고 재배포합니다.

Key는 `/api`에서만 읽어 인증 헤더로 전달합니다. 클라이언트는 `/api/*`만 호출합니다. 환경 파일을 출력·복사·커밋하지 않고 `VITE_` 변수에 Key를 넣지 않습니다.

## 분석 사용법과 범위

챗 패널을 펼쳐 질문을 입력하고 **전송**을 누릅니다. 예시 질문은 입력만 채웁니다. 목록·관심 목록은 화면 순서 최대 20개, 상세는 선택 영상 1개가 대상입니다. 전송할 영상과 답변 당시 대상을 펼쳐 확인할 수 있습니다. 화면 전환 후에도 요청 대상은 유지되며 새로고침하면 챗은 초기화됩니다. 관심 영상은 이 브라우저의 localStorage에 저장됩니다.

서버가 제목·설명·태그·카테고리·날짜·통계·채널 정보를 조회합니다. 영상·음성을 다운로드하거나 분석하지 않습니다. 답변은 핵심 요약·근거 데이터·콘텐츠 제안으로 구성합니다. 상위 3개는 **전달된 대상 내 조회수 기준**이며 부족한 데이터는 판단의 한계를 안내합니다. 답변은 텍스트로 표시합니다.

목록 정렬은 해당 API 응답의 영상들에 적용됩니다. 기본 목록은 한국 `mostPopular`, 검색은 Enter/검색 버튼으로만 요청합니다. 목록·검색·상세는 CDN 캐시를 사용하므로 통계가 항상 최신 순간의 값인 것은 아닙니다. 챗의 메타데이터는 전송 시 서버가 다시 조회합니다.

모델은 `gemini-3.5-flash-lite`입니다. [모델 문서](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)와 [API 가격·할당량 안내](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite)를 참고하세요. Gemini Apps 정책과 Developer API는 구분합니다. Gemini 호출은 25초, 클라이언트 전체 요청은 45초로 제한합니다. 오류·429·빈 답변은 안내하고 전송 버튼으로 직접 다시 요청합니다. 자동 재시도·모델 자동 전환은 없습니다.

## 개발 모드·오류 재현

```powershell
$env:USE_FIXTURES='1'
vercel dev --listen 3000
```

저장된 YouTube 응답으로 UI를 개발합니다. **Gemini는 실제 호출**하므로 전송 시 할당량이 사용됩니다. 실제 YouTube를 사용하려면 `USE_FIXTURES='0'`으로 서버를 재시작합니다. Production은 fixture 설정을 무시합니다.

로컬/Preview 서버의 `API_TEST_YOUTUBE_ERROR` 또는 `API_TEST_GEMINI_ERROR`에 `quota`, `timeout`, `upstream`을 설정하면 해당 오류를 재현합니다.

```powershell
$env:USE_FIXTURES='1'
$env:API_TEST_GEMINI_ERROR='quota'
vercel dev --listen 3000
# 확인 후 서버 종료 → 설정 제거 → 재시작
Remove-Item Env:API_TEST_GEMINI_ERROR
```

Production은 오류 재현 설정을 무시합니다. 공개 mock URL이나 실제 Key 변경으로 재현하지 않습니다. fixture 갱신은 `npm run fixtures -- --run-live`로 명시 실행하며 실제 YouTube 할당량을 사용합니다.

## API·검증

| 경로 | 내용 |
|---|---|
| `GET /api/videos?q=&categoryId=&order=` | 목록·검색, order는 `viewCount`/`date` |
| `GET /api/categories` | 카테고리 |
| `GET /api/video/:id` | 상세, 없는 영상 404 |
| `POST /api/chat` | `{question, videoIds}`만 허용, 서버가 근거 보완 |

질문 1~2,000자, 중복 제거 ID 1~20개, 본문 최대 16KB입니다. 챗 성공·실패는 `no-store`, 오류는 `{code, message}`입니다. 설명 200자, 태그 20개·각 100자로 제한합니다. 누락 통계는 0과 구분해 `null`로 유지하고 조회 불가 영상은 제외합니다.

`test:detail`, `test:favorites`, `test:status`, `test:gemini`, `test:chat`, `test:prompt`, `test:chat-ui`, `test:runtime`은 `npm run`으로 실행하는 모의/회귀 테스트입니다. 실제 Gemini 성공을 대신하지 않습니다.

```powershell
# Production 실제 YouTube + Gemini 세 질문 (자동 재시도 없음)
npm run verify:chat-live -- --run-live --production --source=live --url=https://youtube-trend-orpin.vercel.app
# Git 이력·번들·API 응답 검사: 위치·건수만 출력
npm run check:security
```

로컬 검증은 `--production`을 빼고 `--url=http://localhost:3000 --source=fixture` 또는 `--source=live`를 사용합니다. 실제 응답 전문·판단 기록은 Git에서 제외한 `docs/DECISION.md`에만 저장합니다.

## Vercel 배포·제출물

Vercel에서 GitHub 저장소를 Import하고 두 서버 Key를 등록합니다. `main` push는 Production, 별도 브랜치는 Preview로 자동 배포됩니다. `USE_FIXTURES`와 오류 재현 설정은 Production에 등록하지 않습니다. CLI의 `env pull`은 점검에 사용하지 않습니다.

완료 기준은 [MILESTONE.md](MILESTONE.md), 검증 결과·화면 캡처는 [검증 기록](docs/VERIFICATION.md)을 참고하세요. 내부 PDF·판단 기록·실제 환경 파일은 Git에서 제외합니다.
