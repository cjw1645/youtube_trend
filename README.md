# 유튜브 트렌드 AI 대시보드

YouTube Data API로 조회한 실제 영상 데이터를 바탕으로 인기 콘텐츠와 키워드 흐름을 살펴보고, Gemini에게 데이터 기반 분석과 기획 제안을 받는 웹 서비스입니다. 유튜브 채널 편집자가 다음 콘텐츠의 방향을 정하는 데 쓰도록 만들었습니다.

- 서비스: https://youtube-trend-orpin.vercel.app

## 로컬 실행

필요 도구: Node.js LTS(20 이상), npm

```sh
git clone https://github.com/cjw1645/youtube_trend.git
cd youtube_trend
npm install
```

루트에 `.env.local`을 만들고 아래 두 값을 넣습니다(`.env.example` 참고).

```
YOUTUBE_API_KEY=발급한_YouTube_Key
GEMINI_API_KEY=발급한_Gemini_Key
```

```sh
npm run dev        # 화면 + /api 개발 서버 (Vite 개발 플러그인이 api/*.ts를 실행)
npm run build      # 타입 검사 + 배포용 빌드
```

Vercel Functions 환경 그대로 확인하려면 Vercel CLI(`npm i -g vercel`)로 `vercel dev`를 실행합니다. `npm run preview`는 정적 화면 확인용이라 `/api`가 동작하지 않습니다.

## API Key 발급과 설정

1. **YouTube Data API v3**: [Google Cloud Console](https://console.cloud.google.com)에서 프로젝트를 만들고 「API 및 서비스 → 라이브러리」에서 YouTube Data API v3를 사용 설정한 뒤 「사용자 인증 정보 → API 키 만들기」로 발급합니다. 키 제한은 「API 제한: YouTube Data API v3」로 설정합니다(서버에서 호출하므로 HTTP 리퍼러 제한은 걸지 않습니다). 기본 할당량은 하루 10,000 unit이며, `search.list`는 호출당 100 unit, `videos.list`는 1 unit입니다.
2. **Gemini API**: [Google AI Studio](https://aistudio.google.com)에서 「Get API key」로 발급합니다. 서버는 무료 등급에서 쓸 수 있는 Flash 계열 모델(`gemini-3.5-flash-lite`)을 사용합니다.
3. 로컬은 `.env.local`, 배포는 Vercel 프로젝트 환경변수에 같은 이름으로 넣습니다.

## Vercel 배포 (Hobby)

1. Vercel에서 「Add New → Project」로 GitHub 저장소 `cjw1645/youtube_trend`를 가져옵니다. Framework Preset은 Vite, Build Command `npm run build`, Output Directory `dist`입니다.
2. 「Settings → Environment Variables」에 `YOUTUBE_API_KEY`, `GEMINI_API_KEY`를 Production·Preview에 등록합니다. 값을 바꾸면 다시 배포해야 반영됩니다.
3. Production Branch는 `main`입니다. `main`에 push하면 자동 배포되고, 다른 브랜치는 Preview URL로 배포됩니다.
4. 배포 URL에서 대시보드·영상 검색·상세·관심 영상·AI 답변·오류 안내를 확인하고, 개발자도구 Sources/Network에서 Key 문자열과 `googleapis.com` 직접 호출이 없는지 확인합니다.

## 화면 구성

왼쪽 메뉴에서 **대시보드 · 영상 검색 · AI 대화 · 관심 영상**으로 이동합니다.

### 대시보드

첫 화면입니다. YouTube 한국 인기 차트(`videos.list`, `chart=mostPopular`, `regionCode=KR`)를 페이지를 이어 끝까지(최대 4페이지, 200개) 한 번 수집하고, 그 목록만으로 통계를 계산합니다. 모든 위젯에 「YouTube 인기 차트 N개 기준」처럼 계산 범위를 함께 표시합니다.

| 위젯 | 계산 방법 |
|---|---|
| 요약 숫자 | 인기 영상 수, 업로드 후 24시간 미만 비율, 중앙값 조회수(비공개 제외), 쇼츠 비율(3분 이하) |
| 지금 뜨는 소재 | 태그·제목 단어가 등장한 영상 수 상위 10개(2개 이상 영상). 누르면 영상 검색 화면에서 그 키워드로 검색 |
| 빠르게 조회수를 모으는 영상 Top 5 | 누적 조회수 ÷ 업로드 후 경과 시간(최소 1시간) |
| 카테고리 분포 | 카테고리별 영상 수와 전체 조회수 대비 비중. 누르면 해당 카테고리 탭으로 전환 |
| 쇼츠 / 롱폼 비율 | 3분 이하 / 초과 영상 수와 중앙값 조회수. API에 쇼츠 여부 필드가 없어 길이로만 구분 |
| 참여율 Top 5 | (좋아요 + 댓글) ÷ 조회수. 조회수 1,000 미만·통계 비공개 영상 제외 |

- **카테고리 탭**: 수집한 인기 차트에 실제로 있는 카테고리만 탭으로 표시합니다. 탭을 누르면 추가 API 호출 없이 이미 받은 목록에서 해당 카테고리 영상만 골라 다시 계산합니다. 영상이 10개 미만이면 해석 주의 안내를 표시합니다.
- **이 대시보드 데이터로 AI 질문**: 현재 탭 영상 중 차트 순위 앞 20개를 AI 대화로 넘깁니다.
- 조회수는 누적값 하나뿐이라 「오늘 조회수」, 「급상승」, 순위 변동은 계산하지 않습니다.

### 영상 검색

- 기본은 YouTube 인기 목록 50개입니다. 키워드 검색(Enter 또는 검색 버튼), 카테고리 필터, 인기순·조회수순·최신순 정렬을 지원합니다. 카테고리·정렬은 적용 버튼으로 실행하고, 초기화하면 기본 목록으로 돌아갑니다.
- 키워드·카테고리 검색은 `search.list`로 후보를 찾은 뒤 `videos.list`로 조회수 등 통계를 보완합니다. 검색 결과의 기본 순서는 관련도순이며 전체 YouTube 순위가 아닙니다.
- 카드에는 썸네일, 제목, 채널명, 조회수, 업로드일, 카테고리를 표시합니다.
- 카드를 누르면 상세 창에서 설명, 태그, 조회수, 좋아요, 댓글 수, 채널 구독자 수를 보여줍니다. 비공개 통계는 「정보 없음」으로 표시해 0과 구분합니다.
- 목록 위 키워드 칩은 현재 목록의 태그·제목 단어 중 2개 이상 영상에 나온 상위 10개입니다. 형식 표기(공식, MV, Shorts 등)·회차·1글자·한국어 일반어와 현재 검색어는 제외합니다. 누르면 그 키워드로 검색합니다.
- 「이 목록으로 AI 질문」은 화면 앞쪽 최대 20개를, 「분석 영상 직접 선택」은 고른 1–20개를 AI 대화로 넘깁니다.

### 관심 영상

카드나 상세의 관심 영상 버튼으로 저장·해제하고, 관심 영상 메뉴에서 모아 봅니다. 브라우저 localStorage에 저장하므로 새로고침해도 유지됩니다(다른 기기와는 동기화되지 않습니다).

### AI 대화

1. 대시보드·영상 검색·관심 영상·상세에서 AI 질문 버튼을 누르거나, AI 대화 화면의 「대상 가져오기」에서 현재 검색 결과 / 인기 차트 상위 20개 / 현재 관심 영상 중 하나를 고릅니다.
2. 질문을 입력하고 **전송 버튼**(또는 Enter)을 누를 때만 Gemini를 호출합니다. 처리 중에는 버튼이 「분석 중…」으로 바뀌어 중복 전송을 막습니다. 예시 질문 버튼은 입력란만 채웁니다.
3. 서버가 전송된 영상 ID(최대 20개)의 최신 메타데이터를 다시 조회해 Gemini에 전달합니다. 근거는 제목, 설명(200자), 태그, 카테고리, 업로드일, 조회수, 좋아요, 댓글 수, 채널명, 채널 구독자 수뿐이며 영상·음성은 분석하지 않습니다.

예시 질문: 「현재 유튜브 트렌드를 분석해줘」, 「이 영상이 인기 있는 이유를 분석해줘」, 「다음 콘텐츠 아이디어 3개를 제안해줘」

**답변 형식** — 서버가 질문 유형을 규칙으로 판별해 양식을 정합니다.

- **분석·기획 질문** (트렌드, 인기 이유, 아이디어 등): 세 섹션으로 답합니다.
  - `[핵심 요약]` 질문에 대한 결론 2–3문장. 근거 수치를 문장 안에 함께 씁니다.
  - `[근거 데이터]` 상위 3개 영상의 영상명·조회수·업로드일·관련 키워드. 상위 기준은 출처에 따라 다르며 답변 첫 줄에 기준을 밝힙니다.
    - 인기 차트에서 가져온 대상: YouTube 인기 순위
    - 검색 결과·관심 영상·직접 선택·상세: 업로드 후 일평균 조회수(조회수 ÷ 경과일, 최소 1일)
  - `[콘텐츠 제안]` 새 기획의 제목·소재·썸네일·구성 방향(트렌드 분석은 3개). 근거는 근거 데이터 섹션에만 둡니다.
- **통계 질문** (평균, 합계, 중앙값, 최대·최소, 개수, 비율 등) 섹션 없이 첫 문장에 요청한 값을 답하고 계산 범위를 밝힙니다.

## 구조

```
api/                 Vercel Functions (API Key를 읽는 유일한 위치)
  videos.ts          영상 목록·검색·인기 차트 전체 수집
  categories.ts      카테고리 목록
  video/[id].ts      영상 상세
  chat.ts            AI 질문 (메타데이터 재조회 → Gemini)
  _lib/              youtube.ts, gemini.ts, chat-prompt.ts, chat-input.ts, http.ts
src/
  pages/             Dashboard, Home(영상 검색), Favorites
  components/        VideoCard, VideoDetail, ChatPanel, ChatResult, KeywordChips, StatusView 등
  lib/stats/         대시보드와 AI가 함께 쓰는 통계 계산(키워드, 카테고리 분포, 일평균 조회수, 상위 3개, 집계값)
```
