import { prisma } from "../../lib/prisma";
import { AppError } from "../../shared/errors";

// ─────────────────────────────────────────────────────────────
// Types for the structured standup payload
// ─────────────────────────────────────────────────────────────

interface TaskChange {
	taskId: string;
	taskTitle: string;
	changes: Array<{
		column: string;
		oldValue: string | null;
		newValue: string | null;
		changedBy: string;
		changedAt: string; // ISO 8601
	}>;
}

interface DepartmentSummary {
	departmentId: string;
	departmentName: string;
	completed: TaskChange[]; // Tasks moved to DONE yesterday
	inProgress: TaskChange[]; // Tasks moved to IN_PROGRESS yesterday
	blocked: Array<{
		taskId: string;
		taskTitle: string;
		blockedBy: Array<{ taskId: string; taskTitle: string; status: string }>;
	}>;
	otherChanges: TaskChange[]; // Non-status changes (description, assignee, etc.)
}

export interface StandupPayload {
	projectId: string;
	projectName: string;
	date: string; // YYYY-MM-DD
	timezone: string;
	generatedAt: string; // ISO 8601
	summary: {
		totalChanges: number;
		totalTasksCompleted: number;
		totalTasksInProgress: number;
		totalTasksBlocked: number;
	};
	departments: DepartmentSummary[];
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export class StandupService {
	private readonly defaultTimezone =
		process.env.STANDUP_TIMEZONE ?? "Asia/Jakarta";

	/**
	 * Generate a daily standup summary for a specific project.
	 *
	 * @param projectId — project to summarize
	 * @param date      — YYYY-MM-DD string (defaults to yesterday)
	 * @param force     — if true, regenerates even if one already exists
	 */
	async generate(
		projectId: string,
		date?: string,
		force = false,
	): Promise<StandupPayload> {
		const tz = this.defaultTimezone;

		// Compute target date (defaults to yesterday in STANDUP_TIMEZONE)
		const targetDate = date ?? this.getYesterday(tz);

		// Check for existing standup (idempotent — don't regenerate unless forced)
		if (!force) {
			const existing = await prisma.dailyStandup.findUnique({
				where: { projectId_date: { projectId, date: targetDate } },
			});
			if (existing) {
				return existing.payload as unknown as StandupPayload;
			}
		}

		// Verify project exists
		const project = await prisma.project.findFirst({
			where: { id: projectId, deletedAt: null },
			select: { id: true, name: true },
		});
		if (!project) {
			throw new AppError("NOT_FOUND", 404, "Project not found");
		}

		// Compute day boundaries in UTC from the target timezone
		const { start, end } = this.dayBounds(targetDate, tz);

		// ── 1. Fetch all audit log entries for this project's tasks in the day window
		const auditLogs = await prisma.taskAuditLog.findMany({
			where: {
				task: { projectId, deletedAt: null },
				createdAt: { gte: start, lt: end },
			},
			orderBy: { createdAt: "asc" },
			include: {
				task: {
					select: {
						id: true,
						title: true,
						status: true,
						departmentId: true,
						department: { select: { id: true, name: true } },
					},
				},
				user: { select: { id: true, name: true } },
			},
		});

		// ── 2. Group by department
		const deptMap = new Map<
			string,
			{
				departmentId: string;
				departmentName: string;
				taskChanges: Map<string, TaskChange>;
				completed: Map<string, TaskChange>;
				inProgress: Map<string, TaskChange>;
				blocked: Map<
					string,
					{
						taskId: string;
						taskTitle: string;
						blockedBy: Array<{
							taskId: string;
							taskTitle: string;
							status: string;
						}>;
					}
				>;
			}
		>();

		for (const log of auditLogs) {
			const dept = log.task.department;
			if (!dept) continue;

			if (!deptMap.has(dept.id)) {
				deptMap.set(dept.id, {
					departmentId: dept.id,
					departmentName: dept.name,
					taskChanges: new Map(),
					completed: new Map(),
					inProgress: new Map(),
					blocked: new Map(),
				});
			}
			const bucket = deptMap.get(dept.id)!;

			// Build change entry
			const changeEntry = {
				column: log.changedColumn,
				oldValue: log.oldValue,
				newValue: log.newValue,
				changedBy: log.user.name,
				changedAt: log.createdAt.toISOString(),
			};

			// Status-specific buckets
			if (log.changedColumn === "status") {
				if (log.newValue === "DONE") {
					if (!bucket.completed.has(log.taskId)) {
						bucket.completed.set(log.taskId, {
							taskId: log.taskId,
							taskTitle: log.task.title,
							changes: [],
						});
					}
					bucket.completed.get(log.taskId)!.changes.push(changeEntry);
				} else if (log.newValue === "IN_PROGRESS") {
					if (!bucket.inProgress.has(log.taskId)) {
						bucket.inProgress.set(log.taskId, {
							taskId: log.taskId,
							taskTitle: log.task.title,
							changes: [],
						});
					}
					bucket.inProgress.get(log.taskId)!.changes.push(changeEntry);
				}
			} else {
				// Non-status changes
				if (!bucket.taskChanges.has(log.taskId)) {
					bucket.taskChanges.set(log.taskId, {
						taskId: log.taskId,
						taskTitle: log.task.title,
						changes: [],
					});
				}
				bucket.taskChanges.get(log.taskId)!.changes.push(changeEntry);
			}
		}

		// ── 3. Detect currently blocked tasks per department
		// A task is blocked if ANY of its dependencies is not DONE
		const projectTasks = await prisma.task.findMany({
			where: { projectId, deletedAt: null },
			select: {
				id: true,
				title: true,
				status: true,
				departmentId: true,
				department: { select: { id: true, name: true } },
				dependencies: {
					where: { deletedAt: null, dependsOn: { deletedAt: null } },
					include: {
						dependsOn: { select: { id: true, title: true, status: true } },
					},
				},
			},
		});

		for (const task of projectTasks) {
			// Same rule as the task board: only TODO tasks can be BLOCKED
			if (task.status !== "TODO") continue;

			const unfinishedDeps = task.dependencies.filter(
				(d) => d.dependsOn.status !== "DONE",
			);
			if (unfinishedDeps.length === 0) continue;

			const dept = task.department;
			if (!dept) continue;

			if (!deptMap.has(dept.id)) {
				deptMap.set(dept.id, {
					departmentId: dept.id,
					departmentName: dept.name,
					taskChanges: new Map(),
					completed: new Map(),
					inProgress: new Map(),
					blocked: new Map(),
				});
			}

			deptMap.get(dept.id)!.blocked.set(task.id, {
				taskId: task.id,
				taskTitle: task.title,
				blockedBy: unfinishedDeps.map((d) => ({
					taskId: d.dependsOn.id,
					taskTitle: d.dependsOn.title,
					status: d.dependsOn.status,
				})),
			});
		}

		// ── 4. Assemble payload
		const departments: DepartmentSummary[] = Array.from(deptMap.values()).map(
			(d) => ({
				departmentId: d.departmentId,
				departmentName: d.departmentName,
				completed: Array.from(d.completed.values()),
				inProgress: Array.from(d.inProgress.values()),
				blocked: Array.from(d.blocked.values()),
				otherChanges: Array.from(d.taskChanges.values()),
			}),
		);

		const totalChanges = auditLogs.length;
		const totalTasksCompleted = departments.reduce(
			(s, d) => s + d.completed.length,
			0,
		);
		const totalTasksInProgress = departments.reduce(
			(s, d) => s + d.inProgress.length,
			0,
		);
		const totalTasksBlocked = departments.reduce(
			(s, d) => s + d.blocked.length,
			0,
		);

		const payload: StandupPayload = {
			projectId: project.id,
			projectName: project.name,
			date: targetDate,
			timezone: tz,
			generatedAt: new Date().toISOString(),
			summary: {
				totalChanges,
				totalTasksCompleted,
				totalTasksInProgress,
				totalTasksBlocked,
			},
			departments,
		};

		// ── 5. Persist (upsert to handle force-regeneration)
		await prisma.dailyStandup.upsert({
			where: { projectId_date: { projectId, date: targetDate } },
			create: {
				projectId,
				date: targetDate,
				timezone: tz,
				payload: payload as any,
			},
			update: {
				timezone: tz,
				payload: payload as any,
				generatedAt: new Date(),
			},
		});

		return payload;
	}

	/**
	 * Retrieve a previously generated standup (does NOT generate a new one).
	 */
	async findByProjectAndDate(
		projectId: string,
		date: string,
	): Promise<StandupPayload | null> {
		const row = await prisma.dailyStandup.findUnique({
			where: { projectId_date: { projectId, date } },
		});
		return row ? (row.payload as unknown as StandupPayload) : null;
	}

	/**
	 * List all standups for a project, most recent first.
	 */
	async listByProject(projectId: string, limit = 30) {
		const rows = await prisma.dailyStandup.findMany({
			where: { projectId },
			orderBy: { date: "desc" },
			take: limit,
			select: {
				id: true,
				date: true,
				timezone: true,
				generatedAt: true,
				payload: true,
			},
		});
		return rows.map((r) => ({
			id: r.id,
			date: r.date,
			timezone: r.timezone,
			generatedAt: r.generatedAt,
			summary: (r.payload as any)?.summary ?? null,
		}));
	}

	/**
	 * Batch-generate standups for ALL active projects (for cron / background job).
	 */
	async generateForAllProjects(date?: string, force = false) {
		const projects = await prisma.project.findMany({
			where: { deletedAt: null },
			select: { id: true, name: true },
		});

		const results: Array<{
			projectId: string;
			projectName: string;
			status: "ok" | "error";
			error?: string;
		}> = [];

		for (const project of projects) {
			try {
				await this.generate(project.id, date, force);
				results.push({
					projectId: project.id,
					projectName: project.name,
					status: "ok",
				});
			} catch (err: any) {
				results.push({
					projectId: project.id,
					projectName: project.name,
					status: "error",
					error: err.message,
				});
			}
		}

		return results;
	}

	// ─── Helpers ───────────────────────────────────────────────

	private getYesterday(tz: string): string {
		const now = new Date();
		// Shift to target timezone and subtract a day
		const formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		});
		const parts = formatter.formatToParts(now);
		const y = parts.find((p) => p.type === "year")!.value;
		const m = parts.find((p) => p.type === "month")!.value;
		const d = parts.find((p) => p.type === "day")!.value;

		// Build a Date in that timezone, then subtract 1 day
		const today = new Date(`${y}-${m}-${d}T00:00:00`);
		today.setDate(today.getDate() - 1);

		const yy = today.getFullYear();
		const mm = String(today.getMonth() + 1).padStart(2, "0");
		const dd = String(today.getDate()).padStart(2, "0");
		return `${yy}-${mm}-${dd}`;
	}

	private dayBounds(dateStr: string, tz: string): { start: Date; end: Date } {
		// We need the UTC timestamps for midnight-to-midnight in the given timezone.
		// This uses the Intl API to find the offset.
		const startLocal = new Date(`${dateStr}T00:00:00`);

		// Get UTC offset for the timezone at the start of the day
		const utcDate = new Date(`${dateStr}T12:00:00Z`);
		const localStr = utcDate.toLocaleString("en-US", { timeZone: tz });
		const localDate = new Date(localStr);
		const offsetMs = localDate.getTime() - utcDate.getTime();

		// start = midnight in tz → UTC
		const start = new Date(startLocal.getTime() - offsetMs);
		// end = end of day in tz → UTC (next midnight)
		const nextDay = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);
		const end = new Date(nextDay.getTime() - offsetMs);

		return { start, end };
	}
}

export const standupService = new StandupService();
