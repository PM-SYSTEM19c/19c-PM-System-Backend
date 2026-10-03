import { prisma } from "../../lib/prisma";
import type { AuthUser } from "../../shared/types";

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
    }>
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
}

export const auditService = new AuditService();
