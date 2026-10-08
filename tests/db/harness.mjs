import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';

// 합성 데이터 전용 로컬 Postgres(PGlite). 실제 DB·네트워크·환경 파일을 사용하지 않는다.
const dir = new URL('../../supabase/migrations/', import.meta.url);

export async function createDb() {
  const db = new PGlite();
  // Supabase가 제공하는 역할·auth 스키마의 최소 대역.
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  await db.exec(`grant all on all tables in schema public to service_role;`);
  return db;
}

/** role(anon/authenticated)과 사용자 id로 쿼리를 실행한다. */
export async function as(db, role, userId, sql, params) {
  await db.exec(
    `set role ${role}; select set_config('request.jwt.sub', '${userId ?? ''}', false);`,
  );
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.sub', '', false);`);
  }
}
