# 유튜브 트렌드 AI 대시보드

YouTube Data API로 조회한 실제 영상 데이터를 보고, 그 데이터에 근거해 Gemini에게 트렌드 분석과 콘텐츠 기획을 물어보는 웹 서비스입니다. 유튜브 채널 편집자가 다음 콘텐츠 방향을 정하는 용도입니다.

| 항목 | 값 |
|---|---|
| Git 저장소 | https://github.com/cjw1645/youtube_trend |
| 배포 URL (Vercel Hobby) | https://youtube-trend-orpin.vercel.app |
| 환경변수 예시 | [`.env.example`](.env.example) (값은 비워 둠) |

- 데이터는 YouTube Data API v3 조회 결과만 씁니다(자체 크롤링 없음). 튜밋·블링은 화면 흐름만 참고했고 디자인과 문구는 복제하지 않았습니다.
- 무료 플랜(Vercel Hobby, Supabase Free, Gemini 무료 API)만 사용하며, 한도를 넘으면 기능을 제한할 뿐 유료로 전환하지 않습니다.
- Vercel Hobby는 비상업적 개인 사용 전용입니다.
- 과제 기능 외에 로그인(Google), 검색어 추적, 인기 차트 변화 비교를 추가했습니다. 이 때문에 Supabase를 함께 씁니다.

## 로컬 실행

필요 도구: Node.js 24, npm

```sh
git clone https://github.com/cjw1645/youtube_trend.git
cd youtube_trend
npm install
```

1. 루트에 `.env.local`을 만들고 `.env.example`의 이름대로 값을 채웁니다(Key 발급은 다음 절).
2. 실행합니다.

```sh
npm run dev        # 화면 + /api 개발 서버
npm run build      # 타입 검사 + 배포용 빌드
npm test           # 오프라인 테스트 (실제 외부 서비스·환경 파일에 접근하지 않음)
```

`/api`를 Vercel 환경 그대로 확인하려면 `npx vercel dev`를 씁니다. `npm run preview`는 정적 화면 확인용이라 `/api`가 동작하지 않습니다.

## API Key 발급·설정

값은 코드·문서·채팅에 적지 말고 `.env.local`(로컬)과 Vercel 설정 화면(배포)에만 입력합니다. `.env`·`.env.*`는 `.gitignore`로 제외되어 있습니다.

| 변수 | 발급 방법 |
|---|---|
| `YOUTUBE_API_KEY` | [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 생성 → API 및 서비스 → **YouTube Data API v3** 사용 설정 → 사용자 인증 정보 → API 키 만들기. 키 제한의 API 제한을 YouTube Data API v3로 지정 |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com) → Get API key. 무료 키의 요청·토큰 한도는 AI Studio에서 확인 |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | [Supabase](https://supabase.com) 새 프로젝트 → Project Settings → API |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | 위 URL·anon key와 같은 값. 브라우저에 공개되는 값이므로 **service role 키는 절대 넣지 않음** |
| `COLLECT_SECRET` | 32자 이상 무작위 문자열(예약 수집 인증용) |

`VITE_` 접두사 변수는 클라이언트 번들에 포함되므로 YouTube·Gemini Key에는 쓰지 않습니다. 나머지 선택 변수(호출 상한, 관리자 ID)는 `.env.example`의 주석을 따릅니다.

Supabase 프로젝트 준비:

1. `supabase/migrations/`의 SQL을 파일 이름 순서대로 SQL Editor에서 실행합니다.
2. Google 로그인: Google Cloud에서 웹 OAuth 클라이언트를 만들고 리디렉션 URI에 `https://<프로젝트>.supabase.co/auth/v1/callback`을 추가한 뒤, Supabase Auth → Providers → Google에 클라이언트 ID·Secret을 입력합니다. Auth → URL Configuration에 배포 주소와 로컬 주소를 등록합니다.

## Vercel 배포

1. GitHub 저장소를 Vercel 프로젝트(Hobby)에 연결합니다. Framework Preset은 Vite입니다.
2. Project Settings → Environment Variables에 `.env.example`의 변수(`YOUTUBE_API_KEY`, `GEMINI_API_KEY` 포함)를 Production·Preview에 등록합니다. 값을 바꾸면 재배포해야 반영됩니다.
3. YouTube·Gemini 호출은 `/api` 서버리스 함수에서만 하고, 클라이언트는 `/api` 경로만 호출합니다.
4. `main` 브랜치에 push하면 자동 배포됩니다. 빌드 명령(`vercel.json`)이 `npm test && npm run build`라서 테스트가 실패하면 배포가 중단되고 이전 배포가 유지됩니다.
5. (선택) 배포가 정상인지 확인한 뒤 `supabase/cron/activate_collection.sql`을 읽고 값을 채워 SQL Editor에서 실행하면 인기 목록 정기 수집이 시작됩니다. 자동 실행되지 않습니다.

롤백은 Vercel → Deployments에서 이전 배포를 Promote(Instant Rollback)합니다.

## 한도

로그인 사용자 기준 AI 질문 하루 10회(10초 간격, 동시 1건), 개인 검색 하루 40회이며 한국 시간 자정에 초기화됩니다. 서비스 전체 호출 예산은 환경변수로 조정하고, 소진되면 새 호출만 429로 막히고 저장된 데이터 조회는 계속됩니다.

## 화면 캡처

제출용 캡처는 저장소에 포함하지 않고 별도로 첨부합니다.

| 화면 | 내용 |
|---|---|
| 데이터 조회 | 실제 YouTube 데이터로 채운 영상 목록·상세 |
| 챗봇 답변 | 세 섹션 형식의 AI 답변 |
| 오류 | 할당량 초과·API 오류 안내 |

## 기술 스택

React 19 + TypeScript, Vite, Tailwind CSS, Vercel Functions(`/api`), Supabase(로그인·저장), Gemini `gemini-3.5-flash-lite`(무료 할당량 안의 Flash 계열).

## 폴더 구조

```
api/                 Vercel Functions (Key를 읽는 유일한 위치). 함수 12개 제한 때문에 vercel.json rewrites로 묶음
src/                 화면(pages, components, hooks)과 공용 통계
supabase/migrations/ 데이터 모델·RLS·한도 SQL (순서대로 적용)
tests/               오프라인 테스트 (모의 fetch + 로컬 Postgres)
```
