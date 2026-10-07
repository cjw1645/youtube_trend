import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

// vercel dev의 함수 프로세스에서도 로컬 환경변수를 사용한다.
// 파일 내용은 출력·복사하지 않으며 Production/Preview는 Vercel 설정만 사용한다.
const localDevelopment =
  process.env.VERCEL_ENV === 'development' ||
  (!process.env.VERCEL && process.env.NODE_ENV !== 'production');

if (localDevelopment) {
  const file = path.join(process.cwd(), '.env.local');
  if (existsSync(file)) loadEnvFile(file);
}
