# youtube_trend
개발온보딩

## 로컬 실행

```powershell
npm install
vercel dev --listen 3000
```

Vercel에 연결된 저장소 루트에서 실행합니다. 프론트와 `/api` 서버리스 함수가 같은 주소로 제공됩니다. 포트가 사용 중이면 터미널에 표시된 주소로 접속하세요.

`.env.local`에 `YOUTUBE_API_KEY`, `GEMINI_API_KEY`를 설정합니다. 로컬 함수는 이 파일을 서버 프로세스에서만 로드하며, 배포에서는 Vercel 환경변수를 사용합니다. 키 파일을 커밋하거나 `VITE_` 접두사를 사용하지 마세요.

개발 중 `USE_FIXTURES=1`이면 저장된 YouTube 응답을 사용하므로 할당량을 소모하지 않습니다. 실제 API 점검 시에는 `USE_FIXTURES=0`으로 실행합니다.

빌드 검증: `npm run build`. 진행 상태와 단계별 완료 기준은 `MILESTONE.md`를 참고하세요.

## Gemini 모델 (2-4)

서버 래퍼는 `gemini-3.5-flash-lite`를 사용합니다. 2026-10-06 공식 [모델 문서](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)와 [API 가격표](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite)에서 최신 텍스트용 Flash-Lite 및 Standard 무료 입력·출력을 확인했습니다. 프로젝트별 사용 가능 여부와 한도는 Google AI Studio에서 확인해야 합니다. 다른 모델로 자동 전환하지 않습니다.

10월 9일부터의 모델 접근 변경은 [개인 계정 Gemini Apps 안내](https://support.google.com/gemini/answer/17004136)이며, API 무료 티어와 구분합니다. `USE_FIXTURES`는 YouTube 전용으로 Gemini 답변을 대체하지 않습니다.

호출은 25초로 제한하고 한 요청만 수행합니다. 시간 초과·할당량·외부 실패·빈 답변·안전 차단·출력 잘림을 안전한 오류로 반환합니다. `npm run test:gemini`는 실제 Key·외부 호출 없이 서버 계약과 오류를 검증합니다. 2026-10-06 로컬 API에서 실제 Gemini 응답을 확인했으며 브라우저 챗 통합 검증은 2-7 이후 수행합니다.

## 챗 API 계약 (2-5)

`POST /api/chat`에 `Content-Type: application/json`으로 `{ "question": "분석 질문", "videoIds": ["영상 ID"] }`만 보냅니다. 질문은 1~2,000자, 중복 제거한 대상은 1~20개, 본문은 UTF-8 기준 최대 16KB입니다. 클라이언트 통계·시스템 지시문은 거부합니다.

서버는 영상과 중복 제거한 채널을 일괄 조회하고 카테고리를 이름으로 매핑합니다. 설명은 200자, 태그는 20개·각 100자로 제한합니다. 삭제·비공개 대상은 제외 내역에 표시하고 유효 대상이 없으면 Gemini를 호출하지 않습니다. 답변에는 질문·모델·요청 ID·분석 ID·제외 ID·사용 메타데이터가 함께 반환됩니다. 성공·오류 모두 `no-store`입니다.

`npm run test:chat`은 YouTube/Gemini 모의 응답과 YouTube fixture로 입력 경계·데이터 계약·실패를 검증합니다. 실제 Gemini 답변 검증을 대체하지 않습니다. 전송 UI는 2-7에서 완성합니다.

## 답변 규칙과 실제 검증 (2-6)

답변은 `[핵심 요약]` 2~3줄, `[근거 데이터]` 영상명·정확한 조회수·업로드일, `[콘텐츠 제안]` 제목·소재·썸네일·구성 방향을 갖춘 3개 기획안으로 구성합니다. 트렌드 상위 3개는 서버가 전달된 대상 중 조회수로 계산하며 누락 조회수는 순위에서 제외합니다. 메타데이터 속 명령은 데이터로만 취급하고 부족한 정보·제외된 대상을 안내합니다.

`npm run test:prompt`는 순위·0/null·동률·1/2/20개·시스템 지시문 경계를 외부 호출 없이 검증합니다. 실제 검증은 로컬 서버를 실행한 뒤 `npm run verify:chat-live -- --run-live --source=fixture`로 명시적으로 실행합니다. 이는 실제 Gemini를 호출하며 자동 재시도하지 않습니다. YouTube 모드가 실제 데이터이면 `--source=live`, 다른 로컬 포트이면 `--url=http://localhost:포트`로 기록 조건을 맞추세요. `--questions=2,3`처럼 일부 질문만 실행할 수 있습니다.

2026-10-06 YouTube fixture·실제 Gemini 조건에서 세 예시 질문을 3/1/2개 대상으로 검증했습니다. 세 섹션·근거 제목/조회수/날짜·상위 3개 순서·제안 3개·데이터 부족 안내를 확인했습니다. 실제 YouTube와 Production 검증은 Day 3에서 별도로 진행합니다. 실제 답변 기록은 Git에서 제외한 `docs/DECISION.md`에 보존합니다.
