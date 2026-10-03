import { Prisma, type TaskStatus } from "@prisma/client";
import { prisma, type TxClient } from "../../lib/prisma";

/** Either the global client or an interactive-transaction client */
type Db = TxClient | typeof prisma;

export interface BlockingTask {
	id: string;
	title: string;
	status: TaskStatus;
}

/**
 * Dependency Service
 *
 * Handles task dependency management including circular dependency detection
 * using DFS (Depth-First Search) algorithm.
 *
 * Every read method accepts an optional transaction client so that dependency
 * checks can run *inside* the same transaction (and under the same row locks)
 * as the status write — this closes the check-then-act race window.
 */
export class DependencyService {
	/**
	 * Check if all dependencies of a task are DONE
	 * Returns { allDone, pendingCount, pendingDependencies }
	 */
	async checkDependencies(taskId: string, db: Db = prisma) {
		const dependencies = await db.taskDependency.findMany({
			where: { taskId, deletedAt: null, dependsOn: { deletedAt: null } },
			include: {
				dependsOn: {
					select: { id: true, title: true, status: true },
				},
			},
		});

		const pendingDependencies = dependencies.filter(
			(dep) => dep.dependsOn.status !== "DONE",
		);

		return {
			allDone: pendingDependencies.length === 0,
			pendingCount: pendingDependencies.length,
			dependencies: dependencies.map((dep) => dep.dependsOn),
			pendingDependencies: pendingDependencies.map(
				(dep) => dep.dependsOn,
			) as BlockingTask[],
		};
	}

	/**
	 * Dependents (tasks that depend on `taskId`) that are already started or done.
	 * Used to stop a prerequisite from being reopened underneath active work.
	 */
	async getActiveDependents(
		taskId: string,
		db: Db = prisma,
	): Promise<BlockingTask[]> {
		const rows = await db.taskDependency.findMany({
			where: {
				dependsOnId: taskId,
				deletedAt: null,
				task: { deletedAt: null, status: { in: ["IN_PROGRESS", "DONE"] } },
			},
			include: { task: { select: { id: true, title: true, status: true } } },
		});
		return rows.map((r) => r.task);
	}

	/**
	 * Pessimistic row locks (SELECT ... FOR UPDATE) for a set of tasks.
	 * IDs are sorted so concurrent transactions always lock in the same order
	 * (prevents deadlocks).
	 */
	async lockTasks(tx: TxClient, ids: string[]) {
		const unique = [...new Set(ids)].sort();
		if (unique.length === 0) return;
		await tx.$queryRaw`SELECT id FROM "tasks" WHERE id IN (${Prisma.join(unique)}) ORDER BY id FOR UPDATE`;
	}

	/**
	 * Detect circular dependency using DFS
	 *
	 * When adding edge: taskId depends on dependsOnId
	 * We check if there's already a path from dependsOnId back to taskId
	 * If yes → circular dependency!
	 */
	async detectCircularDependency(
		taskId: string,
		dependsOnId: string,
		db: Db = prisma,
	): Promise<boolean> {
		// BFS/DFS: Starting from dependsOnId, can we reach taskId?
		const visited = new Set<string>();
		const stack = [dependsOnId];

		while (stack.length > 0) {
			const current = stack.pop()!;

			if (current === taskId) {
				return true; // Circular dependency detected!
			}

			if (visited.has(current)) continue;
			visited.add(current);

			// Get all dependencies of the current task
			const deps = await db.taskDependency.findMany({
				where: { taskId: current, deletedAt: null },
				select: { dependsOnId: true },
			});

			for (const dep of deps) {
				if (!visited.has(dep.dependsOnId)) {
					stack.push(dep.dependsOnId);
				}
			}
		}

		return false;
	}

	/**
	 * Determine the effective status of a task considering dependencies
	 * If task is TODO but has pending dependencies, it's effectively BLOCKED
	 */
	async getEffectiveStatus(
		taskId: string,
		currentStatus: string,
		db: Db = prisma,
	) {
		if (currentStatus === "DONE" || currentStatus === "IN_PROGRESS") {
			return currentStatus;
		}

		// For TODO tasks, check if they should be BLOCKED
		const { allDone } = await this.checkDependencies(taskId, db);

		if (currentStatus === "TODO" && !allDone) {
			return "BLOCKED";
		}

		return currentStatus;
	}

	/**
	 * Batch version of getEffectiveStatus for board/list views.
	 * One query for the whole page instead of one per task (no N+1).
	 * Returns effectiveStatus + the list of prerequisites still blocking each task.
	 */
	async getEffectiveStatuses(
		tasks: Array<{ id: string; status: TaskStatus }>,
		db: Db = prisma,
	): Promise<
		Map<string, { effectiveStatus: string; blockedBy: BlockingTask[] }>
	> {
		const result = new Map<
			string,
			{ effectiveStatus: string; blockedBy: BlockingTask[] }
		>();
		const todoIds = tasks.filter((t) => t.status === "TODO").map((t) => t.id);

		const pending = todoIds.length
			? await db.taskDependency.findMany({
					where: {
						taskId: { in: todoIds },
						deletedAt: null,
						dependsOn: { deletedAt: null, status: { not: "DONE" } },
					},
					include: {
						dependsOn: { select: { id: true, title: true, status: true } },
					},
				})
			: [];

		const blockersByTask = new Map<string, BlockingTask[]>();
		for (const dep of pending) {
			const list = blockersByTask.get(dep.taskId) ?? [];
			list.push(dep.dependsOn);
			blockersByTask.set(dep.taskId, list);
		}

		for (const task of tasks) {
			const blockedBy = blockersByTask.get(task.id) ?? [];
			result.set(task.id, {
				effectiveStatus:
					task.status === "TODO" && blockedBy.length > 0
						? "BLOCKED"
						: task.status,
				blockedBy,
			});
		}
		return result;
	}
}

export const dependencyService = new DependencyService();
