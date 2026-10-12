import { prisma } from "../../lib/prisma";

/**
 * Audit Service — Creates immutable audit trail records for task changes
 *
 * Records are never updated or deleted through the application.
 */
export class AuditService {
	/**
	 * Create audit log entries for changed fields
	 */
	async logChanges(
		taskId: string,
		userId: string,
		changes: Array<{
			changedColumn: string;
			oldValue: string | null;
			newValue: string | null;
		}>,
	) {
		if (changes.length === 0) return;

		await prisma.taskAuditLog.createMany({
			data: changes.map((change) => ({
				taskId,
				userId,
				changedColumn: change.changedColumn,
				oldValue: change.oldValue,
				newValue: change.newValue,
			})),
		});
	}

	/**
	 * Get audit logs for a task
	 */
	async getTaskAuditLogs(taskId: string) {
		return prisma.taskAuditLog.findMany({
			where: { taskId },
			orderBy: { createdAt: "desc" },
			include: {
				user: {
					select: {
						id: true,
						name: true,
						email: true,
						role: true,
					},
				},
			},
		});
	}

	/**
	 * Get audit logs for all tasks in a project
	 */
	async getProjectAuditLogs(projectId: string) {
		return prisma.taskAuditLog.findMany({
			where: {
				task: {
					projectId,
				},
			},
			orderBy: { createdAt: "desc" },
			include: {
				task: {
					select: {
						id: true,
						title: true,
					},
				},
				user: {
					select: {
						id: true,
						name: true,
						email: true,
						role: true,
					},
				},
			},
		});
	}

	/**
	 * Get latest global audit logs for PM activity feed
	 */
	async getGlobalAuditLogs(limit: number = 20) {
		return prisma.taskAuditLog.findMany({
			take: limit,
			orderBy: { createdAt: "desc" },
			include: {
				user: { select: { id: true, name: true, role: true } },
				task: {
					select: {
						id: true,
						title: true,
						status: true,
						project: { select: { id: true, name: true } },
					},
				},
			},
		});
	}
}

export const auditService = new AuditService();
