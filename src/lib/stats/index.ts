// 대시보드(src)와 AI 서버(api)가 함께 쓰는 공용 통계. 순수 함수만 두고 외부 API를 호출하지 않는다.
// api 런타임에서도 해석되도록 내부 import는 .js 확장자를 쓴다.
export * from './keywords.js';
export * from './metrics.js';
