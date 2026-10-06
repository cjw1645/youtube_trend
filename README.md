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

호출은 25초로 제한하고 한 요청만 수행합니다. 시간 초과·할당량·외부 실패·빈 답변·안전 차단·출력 잘림을 안전한 오류로 반환합니다. `npm run test:gemini`는 실제 Key·외부 호출 없이 서버 계약과 오류를 검증합니다. 챗 엔드포인트와 실제 답변 검증은 2-5 이후 진행합니다.
