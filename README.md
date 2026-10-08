# 유튜브 트렌드 AI 대시보드

YouTube Data API로 조회한 실제 영상 데이터를 바탕으로 인기 콘텐츠와 키워드 흐름을 살펴보고, Gemini에게 데이터 기반 분석과 기획 제안을 받는 웹 서비스입니다. 유튜브 채널 편집자가 다음 콘텐츠의 방향을 정하는 데 쓰도록 만들었습니다.

- 서비스: https://youtube-trend-orpin.vercel.app
- 무료 플랜(Vercel Hobby + Supabase Free)만 사용합니다. 한도를 넘으면 기능을 제한하며 유료로 자동 전환하지 않습니다.
- Vercel Hobby는 **비상업적 개인 사용 전용**입니다. 광고·결제·판매 등 수익 활동에 쓰려면 Pro 이상이 필요합니다.

## 로컬 실행

필요 도구: Node.js 24(테스트가 TypeScript 파일을 직접 실행), npm

```sh
git clone https://github.com/cjw1645/youtube_trend.git
cd youtube_trend
npm install
```

루트에 `.env.local`을 만들고 `.env.example`의 이름대로 값을 채웁니다. 모든 값은 서버에서만 쓰며(`VITE_` 접두사 두 개만 브라우저 공개용), 실제 값은 Git에 올리지 않습니다.

```sh
npm run dev        # 화면 + /api 개발 서버 (Vite 개발 플러그인이 api/*.ts를 실행)
npm run build      # 타입 검사 + 배포용 빌드
npm run typecheck  # 타입 검사만
npm run format:check
npm test           # 오프라인 테스트 전체 (아래 참고)
```

Vercel Functions 환경 그대로 확인하려면 Vercel CLI(`npm i -g vercel`)로 `vercel dev`를 실행합니다. `npm run preview`는 정적 화면 확인용이라 `/api`가 동작하지 않습니다.

## 테스트

`tests/`의 테스트는 합성 데이터와 모의 fetch만 사용합니다. 실제 YouTube·Gemini·Supabase나 환경 파일에 접근하지 않으며, 로컬 Postgres(PGlite)에 `supabase/migrations/`를 실제로 적용해 SQL 함수까지 검증합니다.

```sh
npm test            # 전체
npm test -- chat    # 파일 이름에 chat이 들어간 것만
```

GitHub Actions(`.github/workflows/ci.yml`)가 `main` push와 PR마다 타입 검사 → 포맷 검사 → 테스트 → 빌드를 실행합니다. 이 테스트는 모델 답변의 품질이나 실제 외부 서비스 동작을 검증하지 않습니다. 실제 호출 평가는 별도로 승인된 소량 예산으로 수행합니다.

## 설정 체크리스트 (배포 전)

값은 문서·채팅·Git에 적지 말고 각 서비스의 설정 화면에 직접 입력합니다.

1. **Supabase 프로젝트**: 새 프로젝트를 만들고 `supabase/migrations/`의 SQL을 파일 이름 순서대로 SQL Editor에서 실행합니다(Free 플랜: DB 500MB, 무료 자동 백업 없음, 비활성 시 일시 중지).
2. **Google 로그인**: Google Cloud에서 웹 OAuth 클라이언트를 만들고 승인된 리디렉션 URI에 Supabase 콜백(`https://<프로젝트>.supabase.co/auth/v1/callback`)을 추가한 뒤, Supabase Auth → Providers → Google에 클라이언트 ID·Secret을 입력합니다. Supabase Auth → URL Configuration에 사이트 URL과 허용 redirect URL(배포 주소, 로컬 주소)을 등록합니다. 기본 신원 권한만 사용하며 YouTube 채널 권한은 요청하지 않습니다.
3. **API Key**: YouTube Data API v3 키(API 제한: YouTube Data API v3), Gemini API 키(Google AI Studio). 무료 모델의 요청·토큰 한도는 AI Studio에서 프로젝트별로 확인합니다.
4. **Vercel 환경변수**(Production·Preview): `.env.example`의 모든 이름. `COLLECT_SECRET`은 32자 이상 무작위 값입니다. 값을 바꾸면 다시 배포해야 반영됩니다.
5. **수집 예약**: 배포가 정상인지 확인한 뒤 `supabase/cron/activate_collection.sql`을 읽고, 값을 직접 채워 Supabase SQL Editor에서 실행합니다(자동 실행되지 않습니다). 비활성화 방법도 같은 파일에 있습니다. 상세 절차: 로컬 문서 `docs/stage3-collection-runbook.md`.
6. **확인**: 로그인, 관심 영상 저장, 검색어 추가, AI 질문 1회, 개발자도구 Network·Sources에서 키 문자열과 `googleapis.com` 직접 호출이 없는지 확인합니다.

### 장애·롤백

- 배포 롤백: Vercel → Deployments에서 이전 배포를 Promote(Instant Rollback)합니다.
- 수집 중단: SQL Editor에서 `select cron.unschedule('collect-popular');` 등으로 예약을 해제하면 새 수집이 멈추고 저장된 데이터는 그대로 보입니다.
- 한도 소진: YouTube·Gemini 전체 예산이 소진되면 새 호출만 429로 막히고 저장된 대시보드·대화 조회는 계속 됩니다.
- DB가 400MiB에 가까워지면 새 수집이 자동 보류됩니다. 만료 정리는 매일 `purge_expired()`가 실행합니다.
- 계정 삭제는 화면의 「계정 삭제」에서 본인이 직접 합니다(관심 영상·검색어·대화가 함께 삭제됩니다).

## 데이터와 보관

| 데이터 | 설명 | 보관 |
|---|---|---|
| 공통 인기 목록 | 한국 인기 차트 최대 200개를 서버가 매시간 저장해 변화를 계산 | 28일 |
| 내 검색어 | 로그인 사용자가 지정한 검색어 최대 2개의 YouTube 검색 결과(최대 200개), 하루 1회 갱신 | 14일 |
| AI 대화 | 로그인 사용자 본인만 조회·삭제, 분석에는 최근 3회 문답만 사용 | 7일 |
| 관심 영상 | 로그인하면 계정에 영상 ID만 저장, 아니면 이 브라우저에 저장 | 삭제 전까지 |

- 표본은 한국 API 인기 목록(또는 검색 결과)이며 전체 YouTube를 대표하지 않습니다. 키워드 비율은 그 목록 안의 영상 비율이며 검색량·시청자 관심도가 아닙니다.
- 영상·음성·썸네일 바이너리, 댓글·자막 본문은 저장하지 않습니다.
- 한도: 사용자별 AI 하루 10회·30초 간격·동시 1건, 개인 검색 하루 40회. 서비스 전체 한도는 환경변수로 조정합니다.

## 화면 구성

왼쪽 메뉴에서 **대시보드 · 영상 검색 · AI 대화 · 관심 영상**으로 이동합니다.

### 대시보드

YouTube 한국 인기 차트(`chart=mostPopular`, `regionCode=KR`)를 끝까지(최대 4페이지, 200개) 수집한 현재 목록의 통계와, 서버가 저장한 수집 기록으로 계산한 변화를 함께 보여줍니다. 모든 위젯에 계산 범위를 표시합니다.

- **현재 목록 통계**: 24시간 내 업로드 비율, 중앙값 조회수, 빠르게 조회수를 모으는 영상, 지금 뜨는 소재(키워드), 카테고리 분포, 영상 길이 구간(1분 이하/1~3분/3~10분/10분 초과 — API에 쇼츠 구분이 없어 길이로 단정하지 않음), 참여율.
- **수집 기록으로 본 변화**: 직전 수집·전일 동시간·7일 전·28일 전과 비교한 키워드·카테고리·길이 구간의 비율 변화(퍼센트포인트), 그대로 남은/새로 들어온/빠진 영상 수, 최근 7일 키워드 추이. 키워드를 누르면 근거 영상이 펼쳐집니다. 해당 시점의 완료된 수집이 없으면 비교를 막고 이유를 표시합니다.
- **내 검색어 탭**: 카테고리 탭 아래 줄의 「＋ 검색어 추가」로 검색어를 등록하면(로그인 필요, 최대 2개) 그 검색 결과의 같은 대시보드가 탭으로 생깁니다. 검색 결과 순서는 인기 순위가 아닙니다.
- **AI 대상 가져오기**: 상위 20개를 AI 대화의 분석 대상으로 가져옵니다. 이미 선택한 대상이 있으면 덮어쓰지 않습니다.

### 영상 검색

기본은 YouTube 인기 목록 50개입니다. 키워드 검색, 카테고리 필터, 인기순·조회수순·최신순 정렬을 지원하고, 카드를 누르면 설명·태그·조회수·좋아요·댓글 수·채널 구독자 수를 상세로 보여줍니다. 비공개 통계는 「정보 없음」으로 0과 구분합니다.

### 관심 영상

카드나 상세의 관심 영상 버튼으로 저장·해제합니다. 로그인하면 계정에 저장되어 다른 기기에서도 보입니다.

### AI 대화 (로그인 필요)

채팅 형식입니다. 질문(1~100자)을 보내면 서버가 대상 영상(최대 20개)의 최신 메타데이터와 저장된 트렌드 집계, 최근 3회 문답을 합쳐 Gemini에 한 번 호출합니다. 근거는 공개 메타데이터뿐이며 영상·음성은 분석하지 않습니다. 인기 순위와 목록 소속은 서버가 저장된 목록으로 검증합니다. 대화는 7일간 저장되어 목록에서 다시 열고 삭제할 수 있습니다.

- **분석·기획 질문**: `[핵심 요약]` · `[근거 데이터]`(상위 3개 영상) · `[콘텐츠 제안]` 세 섹션.
- **통계 질문**(평균·합계·최대 등): 섹션 없이 첫 문장에 값을 답하고 계산 범위를 밝힙니다.

## 구조

```
api/                 Vercel Functions (API Key·service role 키를 읽는 유일한 위치)
  videos.ts categories.ts video/[id].ts   영상 목록·검색·카테고리·상세
  chat.ts conversations.ts                AI 질문(로그인) · 저장된 대화 조회·삭제
  favorites.ts account.ts                 관심 영상 · 계정 삭제
  search-slots.ts search-snapshot.ts search-trend.ts   내 검색어 (로그인)
  snapshot.ts trend.ts                    저장된 공통 인기 목록·집계(공개)
  collect.ts collect-search.ts            수집(예약 인증 전용)
  _lib/              youtube, gemini, auth, usage(한도 예약), chat-service, trend 등
src/                 화면(pages, components, hooks)과 공용 통계(lib/stats)
supabase/migrations/ 데이터 모델·RLS·한도·수집·대화 SQL (순서대로 적용)
supabase/cron/       예약 수집 활성화 템플릿(자동 실행되지 않음)
tests/               오프라인 테스트와 실행기
```
