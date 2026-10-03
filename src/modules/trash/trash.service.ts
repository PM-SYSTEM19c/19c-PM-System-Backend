import { prisma } from "../../lib/prisma";
import { AppError, NotFoundError } from "../../shared/errors";
import type { AuthUser } from "../../shared/types";

export const TRASH_TYPES = [
	"projects",
	"tasks",
	"departments",
	"positions",
] as const;
export type TrashType = (typeof TRASH_TYPES)[number];

/**
 * Trash & Restore — the user-facing half of soft delete.
 *
 * Nothing in this system is ever physically removed (DB triggers forbid it), so
 * "deleted" rows simply carry a `deletedAt`. The trash lists them and restore
 * clears `deletedAt` again, after checking that the row's parents are active
 * (e.g. a task cannot come back inside a project that is still in the trash).
 *
 * There is intentionally NO "delete forever" — permanent deletion is forbidden.
 */
export class TrashService {
	async list() {
		const deleted = { deletedAt: { not: null } };

		const [projects, tasks, departments, positions] = await Promise.all([
			prisma.project.findMany({
				where: deleted,
				orderBy: { deletedAt: "desc" },
				select: {
					id: true,
					name: true,
					description: true,
					deletedAt: true,
					_count: { select: { tasks: { where: { deletedAt: null } } } },
				},
			}),
			prisma.task.findMany({
				where: deleted,
				orderBy: { deletedAt: "desc" },
				select: {
					id: true,
					title: true,
					status: true,
					deletedAt: true,
					project: { select: { id: true, name: true, deletedAt: true } },
					department: { select: { id: true, name: true, deletedAt: true } },
					// Who deleted it — recorded in the immutable audit trail
					auditLogs: {
						where: { changedColumn: "deletedAt", newValue: { not: null } },
						orderBy: { createdAt: "desc" },
						take: 1,
						select: { user: { select: { id: true, name: true } } },
					},
				},
			}),
			prisma.department.findMany({
				where: deleted,
				orderBy: { deletedAt: "desc" },
				select: {
					id: true,
					name: true,
					code: true,
					description: true,
					deletedAt: true,
				},
			}),
			prisma.position.findMany({
				where: deleted,
				orderBy: { deletedAt: "desc" },
				select: { id: true, name: true, description: true, deletedAt: true },
			}),
		]);

		return {
			projects,
			tasks: tasks.map(({ auditLogs, ...t }) => ({
				...t,
				deletedBy: auditLogs[0]?.user ?? null,
				// Restore is only possible when the parents are active
				restoreBlockedReason: t.project.deletedAt
					? `Project "${t.project.name}" is in the trash — restore it first`
					: t.department.deletedAt
						? `Department "${t.department.name}" is in the trash — restore it first`
						: null,
			})),
			departments,
			positions,
		};
	}

	async restore(type: TrashType, id: string, user: AuthUser) {
		switch (type) {
			case "projects":
				return this.restoreProject(id);
			case "tasks":
				return this.restoreTask(id, user);
			case "departments":
				return this.restoreDepartment(id);
			case "positions":
				return this.restorePosition(id);
		}
	}

	private async restoreProject(id: string) {
		const row = await prisma.project.findFirst({
			where: { id, deletedAt: { not: null } },
		});
		if (!row) throw new NotFoundError("Deleted project", id);
		return prisma.project.update({ where: { id }, data: { deletedAt: null } });
	}

	private async restoreTask(id: string, user: AuthUser) {
		return prisma.$transaction(async (tx) => {
			const task = await tx.task.findFirst({
				where: { id, deletedAt: { not: null } },
				include: {
					project: { select: { name: true, deletedAt: true } },
					department: { select: { name: true, deletedAt: true } },
				},
			});
			if (!task) throw new NotFoundError("Deleted task", id);

			if (task.project.deletedAt) {
				throw new AppError(
					"RESTORE_PARENT_DELETED",
					409,
					`Project "${task.project.name}" is in the trash. Restore the project first.`,
				);
			}
			if (task.department.deletedAt) {
				throw new AppError(
					"RESTORE_PARENT_DELETED",
					409,
					`Department "${task.department.name}" is in the trash. Restore the department first.`,
				);
			}

			// Bump version so any client still holding the pre-delete copy gets 409 on edit
			const restored = await tx.task.update({
				where: { id },
				data: { deletedAt: null, version: { increment: 1 } },
			});

			// Restoring is a change to the task → immutable audit entry
			await tx.taskAuditLog.create({
				data: {
					taskId: id,
					userId: user.id,
					changedColumn: "deletedAt",
					oldValue: task.deletedAt?.toISOString() ?? null,
					newValue: null,
				},
			});

			return restored;
		});
	}

	private async restoreDepartment(id: string) {
		const row = await prisma.department.findFirst({
			where: { id, deletedAt: { not: null } },
		});
		if (!row) throw new NotFoundError("Deleted department", id);
		return prisma.department.update({
			where: { id },
			data: { deletedAt: null },
		});
	}

	private async restorePosition(id: string) {
		const row = await prisma.position.findFirst({
			where: { id, deletedAt: { not: null } },
		});
		if (!row) throw new NotFoundError("Deleted position", id);
		return prisma.position.update({ where: { id }, data: { deletedAt: null } });
	}
}

export const trashService = new TrashService();
