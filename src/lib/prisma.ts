import { PrismaClient } from "@prisma/client";
import { AppError } from "../shared/errors";

/**
 * Application-level guard (first line of defense; the database triggers in
 * `db-hardening.ts` are the second):
 *  - `delete` / `deleteMany` are disabled on every model → soft delete only.
 *  - `taskAuditLog` is append-only → `update` / `updateMany` / `upsert` disabled.
 */
function createPrismaClient() {
	const base = new PrismaClient({
		log:
			process.env.NODE_ENV === "development"
				? ["query", "error", "warn"]
				: ["error"],
	});

	const forbidHardDelete = (model: string) => {
		throw new AppError(
			"HARD_DELETE_FORBIDDEN",
			500,
			`Hard delete on ${model} is disabled. Use soft delete (deletedAt).`,
		);
	};
	const forbidAuditMutation = () => {
		throw new AppError(
			"AUDIT_LOG_IMMUTABLE",
			500,
			"Audit log entries are append-only and cannot be modified.",
		);
	};

	return base.$extends({
		name: "soft-delete-and-immutable-audit",
		query: {
			$allModels: {
				delete: ({ model }) => forbidHardDelete(model),
				deleteMany: ({ model }) => forbidHardDelete(model),
			},
			taskAuditLog: {
				update: forbidAuditMutation,
				updateMany: forbidAuditMutation,
				upsert: forbidAuditMutation,
			},
		},
	});
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

/** Client available inside `prisma.$transaction(async (tx) => ...)` for the extended client */
export type TxClient = Omit<
	ExtendedPrismaClient,
	"$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const globalForPrisma = globalThis as unknown as {
	prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
