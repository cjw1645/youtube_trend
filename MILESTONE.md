# 유튜브 트렌드 AI 대시보드 — 3일 완성 마일스톤

> 근거: `개발자온보딩_유튜브트렌드대시보드.pdf` (STEP AI, 2026-09-29)
> 저장소: https://github.com/cjw1645/youtube_trend
> 로컬 폴더: `C:\Users\LOOKSTEN\Desktop\cjw\youtube_trend` (clone 완료, main 브랜치)
> 요구사항 원문: `docs/개발자온보딩_유튜브트렌드대시보드.pdf` (`.gitignore`로 커밋 제외)
>
> **현재 상태 (2026-10-06)**: Day 1 및 Day 2 완료. 사용자 요청으로 2-4~2-6을 main에 push했다. 챗 UI를 목록·관심 목록·상세에 연결하고 실제 Gemini 답변 표시와 화면 전환 후 대상 유지까지 확인했다(YouTube fixture·Gemini 실제). 중복 전송·대상 제한·오류/시간 초과 후 수동 복구·HTML 이스케이프 테스트 및 빌드 통과. 2-8 빌드·Production Ready·목록/상세/실제 Gemini 스모크·입력 거부/no-store 확인까지 완료했다. Day 3 환경·보안·전체 E2E·오류 캡처는 남아 있다 → **다음 단계: Day 3-1**

## 목표 산출물 (마감 시 공유)

- [x] Git 저장소 링크 — https://github.com/cjw1645/youtube_trend
- [x] Vercel 배포 URL — https://youtube-trend-orpin.vercel.app
- [x] `.env.example` (`YOUTUBE_API_KEY=`, `GEMINI_API_KEY=` — 값 비움)
- [ ] README: 로컬 실행 / API Key 발급·설정 / Vercel 배포 방법
- [ ] 화면 캡처 3종: 실제 데이터 조회, 챗봇 답변, 할당량 초과·오류

---

## Day 0 — 사전 준비 (직접 해야 하는 것)

Claude Code가 대신할 수 없는 계정·Key·설치 작업입니다. 모두 끝낸 뒤 Claude Code로 Day 1을 시작하세요.

| # | 항목 | 어디서 / 어떻게 | 확인 방법 | 상태 |
|---|---|---|---|---|
| P1 | GitHub 저장소 | github.com/cjw1645/youtube_trend | 이미 생성함 | ✅ |
| P2 | Node.js LTS (20 이상) | nodejs.org에서 Windows 설치 파일 | `node -v`, `npm -v` | ✅ |
| P3 | Git for Windows + 사용자 정보 | git-scm.com → 설치 후 `git config --global user.name "…"`, `user.email "…"` | `git --version` | ✅ |
| P4 | PC에서 GitHub 로그인 | 첫 `git push` 때 뜨는 Git Credential Manager 창에서 로그인 (또는 `gh auth login`) | clone 성공 (push는 Day 1에 확인) | ✅ |
| P5 | **YouTube Data API v3 Key** | console.cloud.google.com → 새 프로젝트 → "API 및 서비스 > 라이브러리"에서 YouTube Data API v3 **사용 설정** → "사용자 인증 정보 > API 키 만들기" → 키 제한: **API 제한 = YouTube Data API v3만** (서버에서 호출하므로 웹사이트(HTTP 리퍼러) 제한은 걸지 않음) | 기본 할당량 10,000 unit/일 | ✅ |
| P6 | **Gemini API Key (무료)** | aistudio.google.com → "Get API key" → 키 생성 (결제 연결 없이 무료 등급 유지) | AI Studio에서 무료로 쓸 수 있는 Flash 계열 모델 이름 메모 | ✅ |
| P7 | Vercel 계정 (Hobby, 무료) | vercel.com → **GitHub 계정으로 가입** (저장소 import가 쉬워짐) | 대시보드 접속 | ✅ |
| P8 | Vercel CLI 설치·로그인 | `npm i -g vercel` → `vercel login` | `vercel whoami` | ✅ |
| P9 | Claude Code | 데스크톱 앱 Code 탭에서 **`youtube_trend` 폴더** 열기 (또는 PowerShell에서 `irm https://claude.ai/install.ps1 \| iex` 후 폴더에서 `claude`) | 세션 시작됨 | ☐ |
| P10 | `.env.local` 입력 | `YOUTUBE_API_KEY=…`, `GEMINI_API_KEY=…` 두 줄. **채팅창에 붙여넣지 말 것** | 파일 존재, `git status`에 안 보임 | ✅ |

> 참고: 저장소 생성 시 만들어진 `.gitignore`는 Java용 템플릿이라 `.env.local`을 막지 못했음 → Node/Vite용으로 교체 완료. 첫 커밋 전 `git status`에 `.env.local`이 없는지 꼭 확인.

---

## Day 1 — 기반 + 서버 API + 영상 목록

**목표: 실제 YouTube 데이터가 화면에 뜨고, Key는 서버에만 존재**

| # | 작업 | 파일 | 완료 기준 |
|---|---|---|---|
| 1-1 ✅ | 프로젝트 초기화: Vite + React + TS, Tailwind 설정. 폴더에 기존 파일(README·MILESTONE·.env*)이 있으므로 `npm create vite .` 대신 설정 파일을 직접 추가하고, 폴더 구조 `api/_lib`, `api/video`, `src/{components,hooks,pages,types}` 생성 | `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx` | `npm install` 후 `npm run build` 성공 |
| 1-2 ✅ | ~~Git 연결~~ ✅ clone으로 완료. `.gitignore` 교체 ✅ | `.gitignore` | `node_modules`, `.env.local`, `.vercel` 제외 확인 (`.env.*` 규칙 복구) |
| 1-3 ✅ | ~~환경변수~~ ✅ `.env.local` 입력 완료, `.env.example`은 값 비어 있음 | `.env.local`(커밋 안 함), `.env.example` | `VITE_` 접두사 미사용 |
| 1-3b ✅ | (fixture 생성 `npm run fixtures` + 로더 `api/_lib/fixtures.ts` 완료, 래퍼 연결은 1-5에서) 할당량 절약용 목업: YouTube 응답을 한 번만 받아 `api/_fixtures/*.json`에 저장하고, `.env.local`에 `USE_FIXTURES=1`이면 서버가 실제 API 대신 fixture 반환 | `api/_fixtures/` | UI 개발 중 YouTube 할당량 소모 0 |
| 1-4 ✅ | 타입 정의 | `src/types/video.ts` | `Video`, `VideoDetail`, `Category`, `ApiError` |
| 1-5 ✅ | YouTube 래퍼 | `api/_lib/youtube.ts` | `videos.list(chart=mostPopular, regionCode=KR)`, `search.list`, `videoCategories.list`, `channels.list` 래핑, 403 `quotaExceeded` 판별 |
| 1-6 ✅ | 서버리스 엔드포인트 | `api/videos.ts`, `api/categories.ts` | `?q=&categoryId=&order=viewCount\|date` 지원, 에러를 `{code, message}`로 정규화 |
| 1-7 ✅ | 목록 UI | `src/pages/Home.tsx`, `src/components/VideoCard.tsx` | 썸네일·제목·채널명·조회수·업로드일·카테고리 표시, 검색·카테고리 필터·정렬 동작 |
| 1-8 ✅ | 로컬 실행 (**1-9 다음에 진행**: 대시보드 import로 프로젝트 생성 → `vercel link`로 연결 → `vercel dev`) | `api/_lib/env.ts` | `vercel dev` 프론트 200 + `/api/videos` 200(50개) + `/api/categories` 200(14개), 잘못된 정렬 400, 캐시 헤더 및 브라우저 목록 확인. fixture 모드(할당량 0), `npm run build` 성공 |
| 1-9 ✅ | 첫 push & Vercel 연결 (https://youtube-trend-orpin.vercel.app) | — | vercel.com → Add New Project → `cjw1645/youtube_trend` import → Environment Variables에 두 Key 등록 → 배포 성공. 이후 main push 시 자동 배포 |

**주의**
- `search.list`는 호출당 100 unit (일 10,000 한도) → 검색은 Enter/버튼 시에만 호출, 서버 응답에 `Cache-Control: s-maxage` 적용
- `search.list` 결과에는 조회수가 없음 → videoId 모아 `videos.list`로 통계 재조회

---

## Day 2 — 상세 · 관심 영상 · 상태 처리 · AI 챗봇

**목표: 전 기능 로컬 동작**

> 2026-10-06 PDF 대조 보완: Day 1 완료 기록은 유지한다. 완료 항목은 아래 ✅와 단계별 검증 기록을 참고하고 남은 항목부터 진행한다. Production의 실제 API 최종 검증은 Day 3에서 별도로 확인한다. 구현 세부 규칙은 `AGENTS.md`의 “Day 1 이후 구현·검증 보완 기준”을 따른다.

| # | 작업 | 파일 | 완료 기준 |
|---|---|---|---|
| 2-1 ✅ | 상세 API + 화면 | `api/video/[id].ts`, `src/components/VideoDetail.tsx` | 기존 `getVideoDetail` 재사용. 설명·태그·조회수·좋아요·댓글·구독자 수 표시. 잘못된 ID 400, 삭제·비공개 404, 누락 통계·비공개 구독자 수는 0과 구분 |
| 2-2 ✅ | 관심 영상 | `src/hooks/useFavorites.ts`, `src/pages/Favorites.tsx` | 저장/해제·저장 목록·새로고침 유지, ID 중복 방지. 손상된 localStorage·저장 실패 안내, 삭제된 영상도 저장 해제 가능 |
| 2-3 ✅ | 상태 뷰 | `src/components/StatusView.tsx` | 로딩 / 검색 결과 없음 / 관심 영상 없음 / API 오류 / 할당량 초과 구분. 재시도 제공, 빠른 검색·필터·상세 전환에서 이전 응답이 최신 화면을 덮지 않음 |
| 2-4 ✅ | Gemini 래퍼 | `api/_lib/gemini.ts` | 구현 시 무료 사용 가능한 Flash 모델 확인·기록. 서버 전용 Key, 호출 시간 제한, 429·외부 API 실패·빈 응답을 안전한 오류로 정규화. 자동 반복 재시도 없음 |
| 2-5 ✅ | 분석 데이터 준비 + 챗 엔드포인트 | `api/_lib/youtube.ts`, `api/chat.ts`, `src/types/` | 아래 데이터 계약에 따라 현재 화면 영상만 서버에서 일괄 보완. 질문·ID·본문 크기 검증, 메타데이터 길이 제한, 응답·오류 `no-store`. 21개·빈 질문·잘못된 ID 요청은 외부 API 호출 전 거부 |
| 2-6 ✅ | 시스템 프롬프트 | `api/chat.ts` | ①[핵심 요약] 2~3줄 ②[근거 데이터] 영상명/조회수/업로드일 ③[콘텐츠 제안] 제목·소재·썸네일·구성. 트렌드 질문은 분석 대상 내 조회수 상위 3개 + 제안 3개. 3개 미만·누락 통계는 부족함 안내. 데이터 밖 사실·실시간 순위 단정 금지, 메타데이터 속 명령 무시 |
| 2-7 ✅ | 챗 UI | `src/components/ChatPanel.tsx` | 분석 대상·개수 표시, 상세 질문은 선택 영상 1개. 예시 칩은 입력만 채움. 전송 버튼만 호출하며 처리 중 중복 차단. 빈 질문·대상 0개 차단, 오류·시간 초과·429 후 재전송 가능, 답변 원시 HTML 렌더링 금지 |
| 2-8 ✅ | 검증 후 push | — | `npm run build` 통과, 아래 수동 검증 기록 후 자동 배포 확인(main은 Production, 별도 브랜치는 Preview). 완료 기준을 확인한 항목만 체크 |

**2-5 데이터 계약**

- 목록·관심 목록은 현재 표시 중인 영상의 화면 순서대로 최대 20개, 상세는 1개. 10개는 최소 개수가 아니다. 전송 순간 ID를 고정하고 답변에 대상 정보를 연결한다.
- `POST /api/chat` 입력은 질문(최대 2,000자)과 영상 ID 목록(중복 제거 후 1~20개), 본문 최대 16KB. 클라이언트 제공 통계나 시스템 프롬프트는 사용하지 않는다.
- 현재 `Video`에는 설명·태그·구독자 수가 없으므로, 대상 ID만 `videos.list`로 일괄 조회하고 중복 제거한 채널 ID로 `channels.list`를 호출한다. 영상별 상세 API 반복 호출은 피한다. 기존 카테고리 조회 결과로 이름을 매핑한다.
- Gemini에는 제목·설명(최대 200자)·태그(최대 20개, 각 100자)·카테고리·업로드일·조회수·좋아요·댓글 수·채널명·구독자 수를 전달한다. 누락 값은 추측하지 않는다. 삭제된 대상은 제외 사실을 알리고, 유효 영상이 0개이면 Gemini를 호출하지 않는다.

**검증 질문 3종으로 수동 테스트**: "현재 유튜브 트렌드를 분석해줘" / "이 영상이 인기 있는 이유를 분석해줘" / "다음 콘텐츠 아이디어 3개를 제안해줘"

세 질문 모두 실제 Gemini 응답으로 형식·영상명·조회수·업로드일을 입력 데이터와 대조한다. 추가로 대상 0/1/2/20/21개, 비공개 통계, 연속 클릭, 화면 전환, 429·시간 초과 후 복구를 확인한다. UI/오류 분기는 fixture로 검증할 수 있지만 고정 답변을 실제 AI 연동 검증으로 대체하지 않는다.

---

## Day 3 — 배포 검증 · 보안 점검 · 문서 · 마감

**목표: 배포 URL에서 전 기능 정상 + 제출물 완비**

| # | 작업 | 완료 기준 |
|---|---|---|
| 3-1 | Vercel 환경 설정 재확인 | Production/사용하는 Preview에 두 Key 등록 여부 확인(값 출력 금지). Production의 `USE_FIXTURES`와 오류 재현 설정 비활성화, 설정 변경 후 재배포 |
| 3-2 | 보안 점검 | 배포 번들·네트워크·Git 이력에서 Key 노출 점검. `.env.local` 읽기 및 Key·`git log -p` 원문 출력 금지, 결과는 파일·위치·건수만 기록. YouTube/Gemini 데이터 호출은 `/api/*`만 사용, 오류 응답에도 비밀값 없음 |
| 3-3 | 배포 환경 E2E | fixture가 아닌 실제 YouTube 목록·검색·필터·정렬·상세, 관심 영상 새로고침 유지, 실제 Gemini 3질문 검증. 근거 값·대상 범위·형식 대조, 데이터 부족 안내 확인. Day 1의 fixture 검증과 별도로 날짜·URL·결과 기록 |
| 3-4 | 오류 화면 재현 | 로컬/Preview의 서버 전용 설정으로 YouTube 할당량·Gemini 429·일반 오류를 주입. Production에서는 설정 무시, 공개 쿼리 플래그·실제 Key 변경 금지. 오류 안내·재시도·버튼 복구 확인 후 설정 해제. Production에서도 실패 응답 시 UI를 검증하고 모의 여부 명시 |
| 3-5 | UI 다듬기 | 모바일·데스크톱 반응형, 키보드 조작·입력 라벨·상세 닫기/포커스 복귀, 로딩·빈 상태·누락 데이터 문구 확인. 롱폼/Shorts 구분은 필수 완료 후 선택 검토 |
| 3-6 | README / .env.example 점검 | 기존 파일 보완: `vercel dev` 실행, Key 발급·설정, fixture 전환, 실제 API 검증, 사용 모델, 분석 대상·정렬 범위, Vercel 배포 절차. `.env.example` 값은 공란, 비밀 파일 스테이징 없음 |
| 3-7 | 캡처 3종 + 셀프 리뷰 | 실제 데이터·실제 챗봇 답변·오류 캡처에 URL·검증일·실제/모의 조건 기록. 리뷰 5항목 체크, 저장소/배포 링크·README·환경변수 예제·캡처를 확인하고 상단 산출물 체크리스트 갱신 |

**버퍼**: Day 3 오후 2시간은 예비 시간으로 비워둘 것 (할당량 소진·배포 이슈 대비)

---

## 범위 밖 (하지 않음)

화제 인물, 키워드 조합, 광고 영상 분류, 광고단가, 수익 계산기, 채널 비교, 캠페인 대시보드 — 시간이 남으면 가산점 아이디어로만.

## 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| YouTube 일일 할당량(10,000 unit) 소진 | 개발 중 `search.list` 최소화, 응답 캐시, 목록은 `mostPopular` 위주 |
| Gemini 무료 RPM/일일 한도 | 클릭 시에만 호출 + 중복 차단, 429 시 안내 문구 |
| 로컬은 되는데 배포에서 실패 | Day 1에 미리 배포, `vercel dev`로 로컬에서도 서버리스 경로 사용 |
| 토큰 초과 | 영상 20개 이하, 설명은 200자 내로 잘라 전달 |
| Key 유출 | `.env.local`만 사용, 커밋 전 `git status`로 확인, 유출 시 즉시 Key 재발급 |

---

## Day 2 이후 작업 재개 안내

다음 세션은 `AGENTS.md`, `docs/DECISION.md`와 이 문서의 현재 상태를 읽고 **Day 3-1부터** 시작한다. 완료 이력과 미커밋 변경을 보존하며 다시 초기화하지 않는다.

```text
AGENTS.md, docs/DECISION.md와 MILESTONE.md를 읽고 Day 3-1부터 순서대로 진행해줘.
- Day 1은 완료 상태이며, Day 2~3의 보완 기준과 완료 조건을 적용해.
- .env.local은 읽거나 출력·복사하지 말고, Key는 /api에서만 사용해.
- UI 개발은 YouTube fixture 모드를 사용하되 실제 API 검증과 구분해 기록해.
- 완료 기준을 확인한 항목만 체크하고 항목별 작은 커밋으로 남겨.
- 커밋 전 비밀 환경변수 파일과 docs/*.pdf가 스테이징되지 않았는지 확인해.
```

## Day 2~3 작업 운영

- 작업 규칙은 `AGENTS.md`, 진행 상황과 검증 결과는 `MILESTONE.md`에 기록한다.
- `npm run build`와 변경 기능의 핵심 성공·실패 경로를 검증하고, 브라우저에서 로컬 및 배포 화면을 확인한다.
- 세션이 바뀌어도 완료 항목과 다음 항목을 문서에서 이어간다. 특정 도구나 플러그인 설치는 완료 조건이 아니다.
- YouTube fixture 검증, 실제 YouTube 검증, 실제 Gemini 검증, 모의 오류 검증을 구분해 기록한다.
- 커밋은 항목별로 작게 나누고 기존 사용자 변경은 포함하지 않는다. main push는 Production 자동 배포로 이어진다.

## 2-1 검증 기록 (2026-10-06)

- 환경: `vercel dev --listen 3010`, `http://localhost:3010`, YouTube fixture 모드. 실제 YouTube 호출·Production 검증은 Day 3에서 수행한다.
- 상세 API: fixture 영상 200, 설명·태그·조회수·좋아요·댓글·채널 구독자 수 확인. 잘못된 ID 400, 없는 fixture 영상 404. 성공 응답 CDN 600초 캐시, 오류 `no-store`.
- `npm run test:detail`: 실제 Key·외부 API 없이 잘못된 ID 호출 차단, 삭제·비공개에 해당하는 빈 응답 404, 누락 통계 `null`, 조회수 0, 숨긴 구독자 수 `null`, 채널 조회, 할당량 오류 429 검증 통과.
- 브라우저: 카드→상세 모달, 모든 상세 필드, 다른 영상 전환, 닫기 버튼·Escape, 닫은 뒤 원래 카드로 포커스 복귀, Tab으로 모달 내부 이동 확인. 요청 취소 및 취소된 응답 반영 차단 적용.
- `npm run build` 통과. 기존 목록·카테고리 필터 화면 유지. 배포 검증은 2-8/Day 3에서 별도 기록한다.

## 2-2 검증 기록 (2026-10-06)

- 구현: 목록 카드·상세 모달에서 관심 영상 저장/해제, 관심 목록·개수·빈 상태. localStorage에는 버전과 ID로 중복 제거한 영상 목록 메타데이터만 저장하며 상세 정보·Key는 저장하지 않는다.
- 저장 실패 시 기존 목록을 유지하고 오류를 안내한다. 손상 데이터는 유효 항목만 복구하며 자동 덮어쓰기 없이 안내한다. 저장된 메타데이터로 카드를 표시하므로 삭제된 영상도 상세 API 성공 여부와 관계없이 해제 가능하다.
- `npm run test:favorites` 통과: 저장·해제·재조회, 중복 ID, null/0 보존, 손상 JSON/형식/항목, 저장소 접근 차단·용량 초과, 상세 응답의 추가 필드 제외. `npm run test:detail` 회귀 검증 통과.
- 브라우저 `http://localhost:3010`(fixture): 카드 저장→관심 목록→새로고침 후 유지, 상세에서 저장·해제, 목록 개수 동기화·빈 상태 확인.
- 로컬 `/api` fixture 검증: 목록 200(50개), 카테고리 200(14개), 상세 200, 잘못된 ID 400, 없는 영상 404, 성공 캐시·오류 `no-store` 확인.
- 실제 YouTube 검증: 키 파일을 변경하지 않고 `USE_FIXTURES=0` 프로세스 설정으로 `vercel dev --listen 3020` 실행. `/api/videos` 200(50개), `/api/categories` 200(14개), `/api/video/IfRNyaUgEC8` 200(설명·태그·조회수·구독자 확인). 검증 후 해당 서버 종료. Production 검증은 별도이다.
- `npm run build` 통과. 기존 사용자 문서 변경 및 2-1 미커밋 작업을 보존하며 커밋·push는 수행하지 않음.

## 2-3 검증 기록 (2026-10-06)

- 공통 `useApiResource`·`startRequest`를 목록·카테고리·상세에 적용했다. 취소를 무시하고 늦게 도착한 성공·실패 응답도 차단한다. 검색 조건·재시도 변경 직후 이전 결과를 표시하지 않는다.
- 로딩·빈 검색 결과·빈 관심 목록·일반 오류·할당량 초과·없는 영상을 구분하고 수동 재시도를 제공한다. 카테고리 실패도 별도로 안내·재시도하며 전체 목록 탐색은 유지한다. 자동 반복 재시도는 없다.
- `npm run test:status` 통과: 취소된 지연 성공·실패, unmount 취소, 수동 재시도 복구, 네트워크/429/502/잘못된 JSON, 상태별 안내·버튼·접근성 역할. 429·502·404 화면 분기는 테스트 프로세스 모의 응답/서버 렌더링 검증이며 실제 할당량 소진 또는 Production 검증이 아니다.
- `npm run test:detail`, `npm run test:favorites`, `npm run build` 통과. 샌드박스의 Vite SSR 모듈 해석 실패는 승인된 외부 실행으로 검증했으며 앱 JSX 구성은 변경하지 않았다.
- 브라우저 `http://localhost:3010`(fixture): 로딩→없는 검색어 빈 상태, 전체 보기 복귀, 전용 테스트 서버 종료로 연결 실패 안내 및 수동 재시도, 서버 복구 후 50개 목록·상세 조회 확인. 게임→음악→최신순 연속 전환 뒤 음악 22개가 최신순으로 표시됨. 상세 두 영상 전환·관심 목록 회귀 확인.
- 오류 재현은 이번 세션에서 실행한 전용 서버만 종료·복구했다. 환경 파일·실제 Key·공개 오류 쿼리는 변경하지 않았다. 빈 관심 상태는 컴포넌트 테스트와 앞선 2-2 브라우저 검증으로 확인했다.
- 기존 2-1·2-2와 지침·소급 기록을 스테이징했으나 커밋 실행 승인이 거절됨. 해당 인덱스를 보존하며 2-3 변경은 작업 트리에 남겼다. 커밋·push·배포 검증은 미완료이다.

## 2-4 검증 기록 (2026-10-06)

- 공식 모델: gemini-3.5-flash-lite(Stable). https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite 와 https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite 에서 최신 텍스트 Flash-Lite 및 Standard 무료 입력·출력을 확인했다. 10월 9일 변경은 개인 Gemini Apps 안내이며 Developer API와 구분한다(https://support.google.com/gemini/answer/17004136).
- 서버 래퍼: Key는 api/_lib/gemini.ts에서 process.env로 읽어 인증 헤더에만 전달한다. 25초 제한은 응답 본문 읽기까지 적용한다. 단일 요청이며 자동 재시도·다른 모델 fallback·Gemini fixture 답변은 없다.
- npm run test:gemini 통과: 모델·REST 요청 계약, 생각 과정 제외, Key 누락·빈 입력 호출 차단, 429, 400/401/403/404 설정 오류, 500/503·네트워크·잘못된 JSON, 빈 응답, 안전 차단·출력 잘림, 요청/본문 시간 초과, 오류 no-store·비밀값 미노출.
- npm run typecheck 및 npm run build 통과. 테스트는 가짜 Key와 모의 fetch·타이머만 사용했다. 실제 Gemini 생성·무료 프로젝트 한도·브라우저 챗·Production 검증은 2-5 이후 및 Day 3에서 별도로 확인한다. .env.local은 출력·복사·수정하지 않았다.

## 2-5 검증 기록 (2026-10-06)

- POST /api/chat: application/json, 질문 1~2,000자, 중복 제거 ID 1~20개·형식, 실제 UTF-8 스트림 16KB를 외부 API 호출 전에 검증한다. 클라이언트 통계·시스템 지시문 등 추가 필드는 거부한다.
- 요청 ID 순서로 영상 메타데이터를 일괄 조회한다. 채널 ID를 중복 제거하고 기존 카테고리 조회 래퍼로 이름을 매핑한다. 설명 200자·태그 20개/100자, 누락 통계·카테고리 null, 조회수 0을 보존한다. 삭제·비공개 대상 제외와 유효 대상 0개 Gemini 호출 차단을 적용했다.
- 답변에 질문·모델·요청/분석/제외 ID·사용 메타데이터를 연결했다. 성공·오류는 no-store. 공용 오류 헬퍼에서 예상하지 못한 예외 원문을 로그하지 않도록 보완했다.
- npm run test:chat 통과: 0/1/2/20/21개, 중복·순서, 16KB 정확한 경계·초과·가짜 Content-Length·잘못된 UTF-8/JSON, 위조 데이터 거부, videos.list 한 번·channels.list 한 번, 길이 제한·숨긴 구독자·null/0, 일부/전체 삭제, YouTube/Gemini 429, fixture 메타데이터. 모든 Gemini 응답은 테스트 프로세스 모의이며 실제 연동 성공으로 인정하지 않는다.
- npm run test:detail 및 npm run build 통과. 전용 vercel dev 3010 fixture 서버에서 /api/chat 빈 입력 400·없는 영상 404·위조 지시문 400 및 오류 no-store 확인. 이 요청들은 Gemini를 호출하지 않는다.
- 기존 로컬 서버가 종료돼 첫 HTTP 검증은 연결 거부였다. 전용 서버를 재실행해 경로를 확인했다. Key 파일 출력·복사·수정 및 공개 모의 오류 플래그는 사용하지 않았다. 2-6 답변 규칙·2-7 UI·실제 Gemini/Production 검증은 미완료이다.

## 실제 Gemini 선행 검증 (2026-10-06, 2-6 시작 전)

- 사용자 요청에 따라 실제 호출을 먼저 수행했다. http://localhost:3010/api/chat, YouTube fixture 1개·Gemini 실제 호출, gemini-3.5-flash-lite, HTTP 200·no-store 확인.
- 입력: IfRNyaUgEC8 / 제목 OK / 조회수 271087 / 업로드일 2026-09-30T03:02:44Z. 실제 답변의 제목·조회수 271,087·업로드일이 입력과 일치했다. 인기 이유는 제공 데이터만으로 판단하기 어렵다고 안내했다.
- 이 결과는 실제 Gemini 생성 성공이며 실제 YouTube/Production E2E 검증과 구분한다. 2-4·2-5는 이미 완료 체크 상태였으며 이번 결과로 실제 모델·Key·서버 경로 성공 근거를 보완했다. Key 파일 내용을 읽거나 출력·복사하지 않았다.


## 2-6 검증 기록 (2026-10-06)

- 서버 전용 chat-prompt 모듈에서 세 섹션, 요약 2~3줄, 정확한 영상명/조회수/날짜, 제목·소재·썸네일·구성 방향·근거가 있는 제안 3개를 요구한다. 전체 YouTube 순위·인기 원인 단정·영상/음성 분석 주장·메타데이터 지시 실행을 금지한다.
- 서버가 대상 내 조회수 상위 3개를 계산하며 동률은 화면 순서를 유지한다. null 조회수는 순위 제외, 0은 포함. 대상/순위 부족·제외 ID를 입력에 명시한다.
- npm run test:prompt 및 npm run test:chat 통과. 1/2/20개, 동률·0/null·모두 누락·데이터 부족·제외 ID·원래 화면 순서 보존·악성 메타데이터가 시스템 지시문을 바꾸지 않는 계약을 검증했다. 실제 악성 입력에 대한 모델 응답 검증과는 구분한다.
- 실제 Gemini 검증: http://localhost:3010/api/chat, YouTube fixture·Gemini 실제, model gemini-3.5-flash-lite. 2-6 시작 전 단일 영상 응답 200 확인 후 구현을 진행했다. 이후 예시 질문 세 종류를 실제 응답으로 대조했다.
- 트렌드(3개): AIYOU - Eve Music Video / 1,977,553 / 2026-10-02, CRASH / 1,761,309 / 2026-09-28, Come Back To Me / 867,997 / 2026-10-01. 제목·조회수·날짜·대상 내 순서 일치, 세 섹션·요약2줄·제안3개 확인.
- 인기 이유(1개): AIYOU의 동일 근거 값, 요약3줄·단일 대상/원인 판단 부족 안내·제안3개 확인. 아이디어(2개): AIYOU와 CRASH 근거 값 일치, 요약2줄·3개 미만/제한된 근거 안내·제안3개 확인. 모두 HTTP 200·no-store.
- 첫 실제 트렌드 답변의 요약 줄바꿈·제안 제목 라벨이 모호해 지시문을 보완했다. 이후 검증 스크립트가 본문 안의 참고 근거 표현을 라벨로 중복 집계해 실패했으나 실제 필수 라벨 행은 3개였다. 라벨 행만 검사하도록 수정하고 이미 받은 답변은 재호출 없이 수동 확인했다. 나머지 2·3번 질문의 자동 검증은 통과했다. 자동 재시도는 없다.
- 실제 답변 전문은 docs/DECISION.md에 로컬 보존. 명시 실행용 verify:chat-live 스크립트는 환경 파일·Key에 접근하지 않고 /api만 호출한다. npm run build 통과. 브라우저 UI·실제 YouTube·Production 검증은 2-7 이후/Day 3에서 별도로 수행한다.

## 2-7 검증 기록 (2026-10-06)

- App에서 챗 입력·요청·답변 상태를 공유하고 목록/관심 목록은 화면 순서 최대 20개, 상세는 상세 조회 성공한 영상 1개를 전달한다. 전송할 영상 및 전송 당시 영상 목록·질문·출처를 확인할 수 있다.
- 예시 칩은 입력만 변경하고 POST는 전송 버튼으로만 실행한다. 동기 잠금으로 렌더링 전 연속 전송도 차단한다. 빈 질문·0개·2,000자 초과 차단, 45초 전체 요청 시간 제한과 unmount 취소, 지연 응답 차단, 수동 재전송을 구현했다.
- npm run test:chat-ui 통과: 0/1/20개·중복 ID·질문 길이·대상 사본·동기 중복 전송·429/시간 초과/네트워크/외부 오류/빈 답변 후 수동 복구·POST/no-store·HTML 이스케이프. npm run test:status 회귀 테스트 및 npm run build 통과. 오류 분기는 모의 자동 테스트이며 실제 할당량 소진으로 검증한 것이 아니다.
- 브라우저 http://localhost:3010 (vercel dev, YouTube fixture·Gemini 실제): 목록 50개 중 20개 대상 표시, 예시 칩 선택 후 답변/요청 상태 없음, 상세 OK 1개 대상 확인. 전송 직후 버튼/입력/예시 칩 비활성화 확인 후 상세 닫기→관심 목록으로 이동해 요청 대상 1개 유지 및 실제 답변 표시 확인.
- 실제 답변 model gemini-3.5-flash-lite, OK / 271,087 / 2026-09-30 근거 일치. 세 섹션·제안 3개·단일 대상/인기 원인 판단 부족 안내 확인. 검색 변경 시 0개 대상으로 전송이 차단되고 이전 답변의 상세 대상은 유지됨.
- 실제 챗 UI 캡처는 로컬 시각화 폴더 chat-ui.png에 저장했다. 실제 YouTube/Production 통합 및 모의 오류 브라우저 캡처는 2-8/Day 3에서 검증한다.

## 2-8 검증 기록 (2026-10-06)

- 2-7 커밋2714782의 main push 자동 배포 확인: Vercel Production Ready, deployment dpl_2ZWoUPSAagK1vxK9nBnP9LYT4jq1, https://youtube-trend-orpin.vercel.app. categories/chat/video/videos 함수 배포 및 새 챗 UI 표시 확인. npm run build 통과.
- 브라우저 Production 스모크: 목록50개·카테고리·상세 OK 조회 성공, 단일 대상1개로 전송. 처리 중 전송 차단, 실제 gemini-3.5-flash-lite 답변 표시. 상세와 답변의 OK / 276,223 / 2026-09-30 근거 일치, 세 섹션·요약2줄·제안3·정보 부족/인기 원인 단정 금지 확인.
- 상세 닫기→관심 목록(0개)으로 전환해도 원래 상세1개 질문·대상·답변 유지. 현재 대상0개는 전송 비활성화. Production POST /api/chat: 대상0개·21개·빈 질문 모두400 BAD_REQUEST 및 no-store 확인.
- 세 질문 실제 응답3/1/2개 형식·근거 대조는 2-6 기록, 대상0/1/2/20/21개·비공개 통계·연속 클릭·429/시간초과후복구는 2-5/2-7 계약·클라이언트 테스트 기록을 유지한다. 검증 방식은 모의 테스트와 실제 Gemini/Production 스모크를 구분한다. 같은 코드의 통과한 테스트를 불필요하게 반복하지 않았다.
- 실제 Production 챗 답변 캡처 chat-production.png를 로컬 시각화 폴더에 저장. 이번 단계는 자동 배포 및 핵심 연결 확인이며 Day 3 환경 설정·보안 점검·전체 실제 데이터 E2E와 오류 화면 재현은 미완료로 유지한다.
