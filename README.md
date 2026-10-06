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
