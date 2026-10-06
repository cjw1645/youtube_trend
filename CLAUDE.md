# 유튜브 트렌드 AI 대시보드

유튜브 채널 편집자가 인기 콘텐츠·키워드 흐름을 탐색하고, AI에게 데이터 기반 분석을 묻는 웹 서비스. Vercel(Hobby)에 배포.
요구사항 원문은 `docs/개발자온보딩_유튜브트렌드대시보드.pdf`(커밋 제외), 진행 상황·작업 순서는 `MILESTONE.md`. 이 파일만으로 규칙을 지킬 수 있도록 핵심을 요약함.

## 보안 규칙 (반드시 지킬 것)

- `YOUTUBE_API_KEY`, `GEMINI_API_KEY`는 **`/api` 서버리스 함수에서만** `process.env`로 읽는다. 클라이언트(`src/`)는 `/api/*`만 호출하고 `googleapis.com`을 직접 호출하지 않는다.
- **`VITE_` 접두사 변수는 절대 쓰지 않는다** (클라이언트 번들에 포함됨).
- `.env.local`의 내용을 출력·읽기·다른 파일로 복사하지 않는다. `.env.example`에는 키 이름만 두고 값은 비운다.
- 커밋 전에 `git status`로 `.env.local`(및 `.env*`)이 스테이징되지 않았는지 확인한다.
- `docs/*.pdf`는 커밋하지 않는다.

## 기술 스택

- React + TypeScript (Vite), Tailwind CSS
- 서버: Vercel Functions (`api/*.ts`), 로컬은 `vercel dev`로 프론트 + `/api` 동시 실행
- 데이터: YouTube Data API v3에서 조회한 데이터만 사용 (자체 수집 데이터 없음)
- AI: Gemini 무료 API Key + 무료 할당량 안의 Flash 계열 모델

## 폴더 구조

```
api/            Vercel 서버리스 함수 (Key 사용 가능한 유일한 곳)
  _lib/         youtube.ts, gemini.ts 등 공용 래퍼 (_ 접두사 → 엔드포인트로 노출 안 됨)
  _fixtures/    할당량 절약용 YouTube 응답 목업 (USE_FIXTURES=1일 때 사용)
  video/[id].ts 상세
  videos.ts, categories.ts, chat.ts
src/
  components/ hooks/ pages/ types/
```

## 기능 요구사항

- **영상 목록**: 썸네일, 제목, 채널명, 조회수, 업로드일, 카테고리 표시. 키워드 검색, 카테고리 필터, 조회수순·최신순 정렬.
- **영상 상세**: 설명, 태그, 조회수, 좋아요, 댓글 수, 채널 구독자 수 (`channels.list`).
- **관심 영상**: 저장/해제, 저장 목록 보기, 새로고침 후에도 유지 (localStorage).
- **상태 처리**: 로딩 / 검색 결과 없음 / API 오류(할당량 초과 포함)를 각각 다른 화면으로 구분.

## AI 챗봇

- 이미 게시된 영상의 **메타데이터만** 근거로 답한다 (영상·음성 다운로드·분석 금지, 고정 답변 금지).
- 전달 메타데이터: 제목, 설명(약 200자로 축약), 태그, 카테고리, 업로드일, 조회수, 좋아요, 댓글 수, 채널명, 채널 구독자 수.
- 전달 대상은 **현재 화면에서 실제로 조회한 영상**, 한 요청에 **최대 10~20개**.
- **전송 버튼을 누를 때만** 호출, 처리 중에는 버튼 비활성화로 중복 전송 차단.
- 답변 형식:
  1. `[핵심 요약]` 현재 트렌드 특징 2~3줄
  2. `[근거 데이터]` 영상명 / 조회수 / 업로드일
  3. `[콘텐츠 제안]` 제목, 소재, 썸네일, 구성 방향
- "현재 트렌드 분석" 질문에는 상위 영상 3개 + 기획 제안 3개 포함.
- 데이터에 없는 사실·실시간 순위 변동을 단정하지 않고, 정보가 부족하면 "판단이 어렵다"고 안내.
- API 오류·무료 할당량 초과(429) 시 사용자에게 안내 메시지 표시.
- 예시 질문: "현재 유튜브 트렌드를 분석해줘" / "이 영상이 인기 있는 이유를 분석해줘" / "다음 콘텐츠 아이디어 3개를 제안해줘"

## YouTube API 할당량 주의 (일 10,000 unit)

- `search.list`는 호출당 100 unit → Enter/버튼 시에만 호출, 서버 응답에 `Cache-Control: s-maxage` 적용.
- `search.list` 결과에는 조회수가 없으므로 videoId를 모아 `videos.list`로 통계를 재조회.
- 목록 기본값은 `videos.list(chart=mostPopular, regionCode=KR)`.
- 403 `quotaExceeded`를 판별해 `{code, message}` 형태로 정규화해 내려준다.
- UI 개발 중에는 `USE_FIXTURES=1`로 fixture 응답 사용.

## 참고 / 범위

- 레퍼런스: 튜밋(tumeet.ai, 인기 급상승 목록·카테고리 탭), 블링(vling.net, 검색 필터·정렬, 롱폼/Shorts 탭, 즐겨찾기). 화면 흐름·정보 배치만 참고하고 디자인·문구는 복제하지 않는다.
- 범위 밖: 화제 인물, 키워드 조합, 광고 영상 분류, 광고단가, 수익 계산기, 채널 비교, 캠페인 대시보드.

## 배포 · 제출물

- GitHub `cjw1645/youtube_trend` main push 시 Vercel 자동 배포. Vercel Environment Variables에 두 Key 등록.
- 배포 URL에서 개발자도구로 번들·네트워크에 Key가 보이지 않는지 확인.
- 제출: 저장소 링크, 배포 URL, `.env.example`, README(로컬 실행 / Key 발급·설정 / Vercel 배포), 화면 캡처 3종(실제 데이터 조회, 챗봇 답변, 할당량 초과·오류).
- 리뷰 기준: API 연동·보안 / 기능 완성도 / 챗봇 품질 / 코드·화면 / 배포.

## 작업 방식

- `MILESTONE.md`의 항목 순서대로 진행하고, 완료 기준 확인 후 체크.
- 항목별 작은 커밋 (예: `feat: 1-5 youtube wrapper`).
