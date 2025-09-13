import { Pool } from "pg";

export const db = new Pool({ connectionString: process.env.DATABASE_URL });

export async function migrate() {
    // simple loader for 001_init.sql
    const sql = (await import('node:fs/promises')).readFile;
    const path = new URL('./migrations/001_init.sql', import.meta.url);
    const ddl = await sql(path, 'utf8');
    await db.query(ddl);
}