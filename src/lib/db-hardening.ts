import type { PrismaClient } from "@prisma/client";

/**
 * Database-level hardening (defense in depth, independent of application code).
 *
 * 1. Soft delete is mandatory: a BEFORE DELETE / BEFORE TRUNCATE trigger on every
 *    business table rejects physical deletion. Rows can only be "deleted" by
 *    setting `deletedAt`.
 * 2. The audit trail is immutable: `task_audit_logs` additionally rejects UPDATE.
 *    Rows can only be INSERTed — not even a DB user with write access via the app
 *    connection can rewrite history.
 *
 * Every statement is idempotent (CREATE OR REPLACE / DROP IF EXISTS), so this runs
 * safely on every server start and via `bun run db:harden`.
 */

export const SOFT_DELETE_TABLES = [
	"departments",
	"positions",
	"users",
	"projects",
	"project_departments",
	"tasks",
	"task_dependencies",
	"task_attachments",
	"task_audit_logs",
	"daily_standups",
] as const;

const STATEMENTS: string[] = [
	// --- Function: forbid physical DELETE / TRUNCATE ---------------------------
	`CREATE OR REPLACE FUNCTION pms_forbid_hard_delete() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION 'HARD_DELETE_FORBIDDEN: % on table "%" is not allowed. Use soft delete (set "deletedAt").', TG_OP, TG_TABLE_NAME
       USING ERRCODE = 'P0001';
   END;
   $$ LANGUAGE plpgsql;`,

	// --- Function: audit log rows are append-only ------------------------------
	`CREATE OR REPLACE FUNCTION pms_audit_log_immutable() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: % on "task_audit_logs" is not allowed. Audit entries are append-only.', TG_OP
       USING ERRCODE = 'P0001';
   END;
   $$ LANGUAGE plpgsql;`,

	// --- Triggers on every business table --------------------------------------
	...SOFT_DELETE_TABLES.flatMap((table) => [
		`DROP TRIGGER IF EXISTS pms_no_delete ON "${table}";`,
		`CREATE TRIGGER pms_no_delete BEFORE DELETE ON "${table}"
       FOR EACH ROW EXECUTE FUNCTION pms_forbid_hard_delete();`,
		`DROP TRIGGER IF EXISTS pms_no_truncate ON "${table}";`,
		`CREATE TRIGGER pms_no_truncate BEFORE TRUNCATE ON "${table}"
       FOR EACH STATEMENT EXECUTE FUNCTION pms_forbid_hard_delete();`,
	]),

	// --- Audit log: forbid UPDATE as well --------------------------------------
	`DROP TRIGGER IF EXISTS pms_audit_no_update ON "task_audit_logs";`,
	`CREATE TRIGGER pms_audit_no_update BEFORE UPDATE ON "task_audit_logs"
     FOR EACH ROW EXECUTE FUNCTION pms_audit_log_immutable();`,
];

export async function applyDbHardening(
	db: Pick<PrismaClient, "$executeRawUnsafe">,
) {
	for (const sql of STATEMENTS) {
		await db.$executeRawUnsafe(sql);
	}
	return { tables: SOFT_DELETE_TABLES.length, statements: STATEMENTS.length };
}
