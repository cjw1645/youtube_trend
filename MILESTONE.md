# 유튜브 트렌드 AI 대시보드 — 3일 완성 마일스톤

> 근거: `개발자온보딩_유튜브트렌드대시보드.pdf` (STEP AI, 2026-09-29)
> 저장소: https://github.com/cjw1645/youtube_trend
> 로컬 폴더: `C:\Users\LOOKSTEN\Desktop\cjw\youtube_trend` (clone 완료, main 브랜치)
> 요구사항 원문: `docs/개발자온보딩_유튜브트렌드대시보드.pdf` (`.gitignore`로 커밋 제외)
>
> **현재 상태 (2026-10-06)**: Day 0 사전 준비 전부 완료(Node.js·Vercel CLI 로그인 포함), 저장소 clone·GitHub 인증 완료, `.env.local`에 두 Key 입력 완료, `.gitignore`를 Node/Vite용으로 교체(`.env.local` 제외 확인). 저장소에는 `README.md`, `.gitignore`, `.env.example`, `MILESTONE.md`만 있고 소스 코드·`package.json`은 아직 없음 → **Day 1-1부터 시작**

## 목표 산출물 (마감 시 공유)

- [x] Git 저장소 링크 — https://github.com/cjw1645/youtube_trend
- [ ] Vercel 배포 URL
- [ ] `.env.example` (`YOUTUBE_API_KEY=`, `GEMINI_API_KEY=` — 값 비움)
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
| 1-2 | ~~Git 연결~~ ✅ clone으로 완료. `.gitignore` 교체 ✅ | `.gitignore` | `node_modules`, `.env.local`, `.vercel` 제외 확인 |
| 1-3 | ~~환경변수~~ ✅ `.env.local` 입력 완료, `.env.example`은 값 비어 있음 | `.env.local`(커밋 안 함), `.env.example` | `VITE_` 접두사 미사용 |
| 1-3b ✅ | (fixture 생성 `npm run fixtures` + 로더 `api/_lib/fixtures.ts` 완료, 래퍼 연결은 1-5에서) 할당량 절약용 목업: YouTube 응답을 한 번만 받아 `api/_fixtures/*.json`에 저장하고, `.env.local`에 `USE_FIXTURES=1`이면 서버가 실제 API 대신 fixture 반환 | `api/_fixtures/` | UI 개발 중 YouTube 할당량 소모 0 |
| 1-4 | 타입 정의 | `src/types/video.ts` | `Video`, `VideoDetail`, `Category`, `ApiError` |
| 1-5 | YouTube 래퍼 | `api/_lib/youtube.ts` | `videos.list(chart=mostPopular, regionCode=KR)`, `search.list`, `videoCategories.list`, `channels.list` 래핑, 403 `quotaExceeded` 판별 |
| 1-6 | 서버리스 엔드포인트 | `api/videos.ts`, `api/categories.ts` | `?q=&categoryId=&order=viewCount\|date` 지원, 에러를 `{code, message}`로 정규화 |
| 1-7 | 목록 UI | `src/pages/Home.tsx`, `src/components/VideoCard.tsx` | 썸네일·제목·채널명·조회수·업로드일·카테고리 표시, 검색·카테고리 필터·정렬 동작 |
| 1-8 | 로컬 실행 | — | `vercel dev`로 프론트 + `/api` 동시 실행 확인 |
| 1-9 | 첫 push & Vercel 연결 | — | vercel.com → Add New Project → `cjw1645/youtube_trend` import → Environment Variables에 두 Key 등록 → 배포 성공. 이후 main push 시 자동 배포 |

**주의**
- `search.list`는 호출당 100 unit (일 10,000 한도) → 검색은 Enter/버튼 시에만 호출, 서버 응답에 `Cache-Control: s-maxage` 적용
- `search.list` 결과에는 조회수가 없음 → videoId 모아 `videos.list`로 통계 재조회

---

## Day 2 — 상세 · 관심 영상 · 상태 처리 · AI 챗봇

**목표: 전 기능 로컬 동작**

| # | 작업 | 파일 | 완료 기준 |
|---|---|---|---|
| 2-1 | 상세 API + 화면 | `api/video/[id].ts`, `src/components/VideoDetail.tsx` | 설명, 태그, 조회수, 좋아요, 댓글 수, **채널 구독자 수** (channels.list) |
| 2-2 | 관심 영상 | `src/hooks/useFavorites.ts`, `src/pages/Favorites.tsx` | 저장/해제, 목록 보기, localStorage로 새로고침 후 유지 |
| 2-3 | 상태 뷰 | `src/components/StatusView.tsx` | 로딩 / 검색 결과 없음 / API 오류 / 할당량 초과를 **각각 다른 화면**으로 |
| 2-4 | Gemini 래퍼 | `api/_lib/gemini.ts` | P6에서 확인한 무료 Flash 계열 모델, 429·할당량 초과 판별 |
| 2-5 | 챗 엔드포인트 | `api/chat.ts` | 클라이언트가 보낸 **현재 화면 영상 최대 10~20개** 메타데이터만 전달 (제목·설명(축약)·태그·카테고리·업로드일·조회수·좋아요·댓글·채널명·구독자) |
| 2-6 | 시스템 프롬프트 | `api/chat.ts` | 답변 형식 강제: ①[핵심 요약] 2~3줄 ②[근거 데이터] 영상명/조회수/업로드일 ③[콘텐츠 제안] 제목·소재·썸네일·구성. "트렌드 분석" 시 상위 3개 + 제안 3개. 데이터 밖 사실·실시간 순위 단정 금지, 부족하면 "판단 어려움" |
| 2-7 | 챗 UI | `src/components/ChatPanel.tsx` | 전송 버튼 클릭 시에만 호출, 처리 중 버튼 disabled(중복 전송 차단), 예시 질문 3개 칩, 오류·할당량 안내 |
| 2-8 | push | — | Vercel Preview/Production 자동 배포 확인 |

**검증 질문 3종으로 수동 테스트**: "현재 유튜브 트렌드를 분석해줘" / "이 영상이 인기 있는 이유를 분석해줘" / "다음 콘텐츠 아이디어 3개를 제안해줘"

---

## Day 3 — 배포 검증 · 보안 점검 · 문서 · 마감

**목표: 배포 URL에서 전 기능 정상 + 제출물 완비**

| # | 작업 | 완료 기준 |
|---|---|---|
| 3-1 | Vercel 환경변수 재확인 (`YOUTUBE_API_KEY`, `GEMINI_API_KEY`) | Production/Preview 모두 등록 |
| 3-2 | 보안 점검 | 배포 URL → 개발자도구 Sources 번들에서 Key 문자열 검색 0건, Network 탭에 `googleapis.com` 직접 호출 없음(`/api/*`만), `git log -p`에 Key 흔적 없음 |
| 3-3 | 배포 환경 E2E | 검색·필터·정렬·상세·관심영상(새로고침)·챗봇 3질문·오류 화면 |
| 3-4 | 오류 화면 재현 | 잘못된 Key 또는 서버에서 `?mock=quota` 같은 테스트 플래그로 할당량 초과 화면 캡처 |
| 3-5 | UI 다듬기 | 롱폼/Shorts 구분(선택), 반응형, 빈 상태 문구 |
| 3-6 | README / .env.example 작성 | 로컬 실행, Key 발급·설정(Day 0 P5·P6 내용 활용), Vercel 배포 절차 |
| 3-7 | 캡처 3종 + 셀프 리뷰 | 리뷰 기준 5항목(API 연동·보안 / 기능 / 챗봇 품질 / 코드·화면 / 배포) 체크 |

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

## Claude Code 시작 프롬프트

Day 0을 모두 끝낸 뒤, 로컬 폴더에서 Claude Code를 열고 아래를 붙여넣으세요.

```
docs/개발자온보딩_유튜브트렌드대시보드.pdf(요구사항 원문)와 MILESTONE.md를 읽어줘.
읽은 뒤 요구사항 핵심을 CLAUDE.md에 정리하고, Day 1을 1-1부터 진행해줘.
- 저장소: https://github.com/cjw1645/youtube_trend (main 브랜치, 이미 clone됨)
- .env.local에 Key가 이미 있음. 파일 내용을 출력하거나 다른 파일에 복사하지 마.
- Key는 /api 서버리스 함수에서만 쓰고 VITE_ 접두사는 절대 쓰지 마.
- 커밋 전에 git status로 .env.local이 빠져 있는지 확인해.
- 각 단계가 끝나면 완료 기준을 확인하고 MILESTONE.md 체크 후 다음으로 넘어가.
```

`CLAUDE.md`에는 PDF의 요구사항 요약 + 보안 규칙(Key는 서버 전용, `VITE_` 금지, `.env.local` 커밋 금지)이 들어가야 합니다. 이후 세션은 PDF를 다시 읽지 않아도 `CLAUDE.md`만으로 규칙을 지킵니다.

---

## 효율적으로 진행하는 법 (Claude Code)

| 방법 | 언제 | 효과 |
|---|---|---|
| `.claude/settings.json` (저장소에 포함) | 처음부터 | 자주 쓰는 npm·git·vercel dev 명령은 매번 묻지 않음, Claude의 `.env.local` 읽기 차단, `git push`·`vercel --prod`는 항상 확인 |
| `CLAUDE.md` | 첫 세션 | PDF 요구사항 + 보안 규칙을 매 세션 자동 적용 → PDF 재독 불필요 |
| 계획 모드 `Shift+Tab` | 각 Day 시작 시 | 코드를 고치기 전에 그날 작업 계획을 먼저 확인 |
| 항목별 작은 커밋 | 마일스톤 항목마다 | `feat: 1-5 youtube wrapper`처럼 커밋 → 되돌리기 쉬움, 리뷰어가 보기 좋음 |
| `/clear` | Day 바뀔 때 | 컨텍스트 정리 → 응답 속도·정확도 유지 (규칙은 CLAUDE.md, 진행 상황은 MILESTONE.md에 남아 있음) |
| `Esc` 두 번 (되돌리기) | 방향이 틀렸을 때 | 이전 시점으로 코드·대화 되감기 |
| fixture 모드 (1-3b) | Day 1~2 UI 작업 | YouTube 일일 할당량 보호 |
| `frontend-design` 스킬 | 1-7, 2-x UI 작업 | 템플릿 같지 않은 화면 구성 |
| `/security-review` (기본 제공) | Day 3-2 | Key 노출·서버 경유 여부 자동 점검 |
| `code-review` 플러그인 | 제출 전 | 리뷰 기준(코드 구조·예외 처리)으로 셀프 점검 |
| `playwright` 플러그인 | Day 3-3, 3-7 | 배포 URL 전 기능 E2E + 캡처 3종 자동화 |

플러그인은 Claude Code에서 `/plugin`으로 설치합니다 (Cowork에 설치한 것과 별도).
