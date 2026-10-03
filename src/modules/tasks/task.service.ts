import type { Prisma, TaskStatus } from "@prisma/client";
import { ERROR_CODES } from "../../config/constants";
import { prisma, type TxClient } from "../../lib/prisma";
import {
	AppError,
	CircularDependencyError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
	VersionConflictError,
} from "../../shared/errors";
import type { AuthUser } from "../../shared/types";
import type { ListQueryResult } from "../../shared/utils/pagination";
import { auditService } from "./task.audit";
import { dependencyService } from "./task.dependency";
import {
	assertCanUpdateStatus,
	canManageDependencies,
	canUpdateTaskFields,
} from "./task.permission";
import type {
	CreateTaskInput,
	UpdateTaskInput,
	UpdateTaskStatusInput,
} from "./task.schema";

const EDITABLE_FIELDS = [
	"title",
	"description",
	"departmentId",
	"assigneeId",
	"clientVisible",
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Null/undefined/"" are treated as the same "empty" value when comparing edits */
function sameValue(a: unknown, b: unknown) {
	const norm = (v: unknown) => (v === undefined || v === "" ? null : v);
	return norm(a) === norm(b);
}

const TASK_INCLUDE = {
	project: { select: { id: true, name: true } },
	department: { select: { id: true, name: true, code: true } },
	assignee: {
		select: { id: true, name: true, email: true, role: true, position: true },
	},
} satisfies Prisma.TaskInclude;

export class TaskService {
	/**
	 * List tasks with filtering, search, pagination
	 */
	async findAll(user: AuthUser, listQuery: ListQueryResult) {
		const { skip, take, orderBy } = listQuery;

		const scope: any = { deletedAt: null };

		// Role-based scoping
		if (user.role === "INTERNAL") {
			// INTERNAL can only see tasks in their department within their projects
			scope.project = {
				departments: {
					some: { departmentId: user.departmentId, deletedAt: null },
				},
			};
		} else if (user.role === "CLIENT") {
			// Client should use /client endpoints, but if they reach here, restrict
			scope.clientVisible = true;
			scope.project = {
				clientId: user.id,
			};
		}
		// PM can see all tasks

		// Filters & search are built by @nodewave/prisma-ezfilter; role scope is AND-ed
		const whereClause: any = { AND: [scope, listQuery.where] };

		const [tasks, total] = await Promise.all([
			prisma.task.findMany({
				where: whereClause,
				skip,
				take,
				orderBy: orderBy as any,
				include: {
					project: { select: { id: true, name: true } },
					department: { select: { id: true, name: true, code: true } },
					assignee: {
						select: {
							id: true,
							name: true,
							email: true,
							role: true,
							position: true,
						},
					},
					dependencies: {
						where: { deletedAt: null, dependsOn: { deletedAt: null } },
						include: {
							dependsOn: {
								select: { id: true, title: true, status: true },
							},
						},
					},
					_count: {
						select: {
							attachments: { where: { deletedAt: null } },
							auditLogs: true,
						},
					},
				},
			}),
			prisma.task.count({ where: whereClause }),
		]);

		// Calculate effective status (BLOCKED state) for the whole page in ONE query
		const effective = await dependencyService.getEffectiveStatuses(tasks);
		const tasksWithEffectiveStatus = tasks.map((task) => {
			const e = effective.get(task.id);
			return {
				...task,
				effectiveStatus: e?.effectiveStatus ?? task.status,
				blockedBy: e?.blockedBy ?? [],
			};
		});

		return { data: tasksWithEffectiveStatus, total };
	}

	/**
	 * Get task by ID with all details
	 */
	async findById(taskId: string, _user: AuthUser) {
		const task = await prisma.task.findFirst({
			where: { id: taskId, deletedAt: null },
			include: {
				project: { select: { id: true, name: true } },
				department: { select: { id: true, name: true, code: true } },
				assignee: {
					select: {
						id: true,
						name: true,
						email: true,
						role: true,
						position: true,
					},
				},
				dependencies: {
					where: { deletedAt: null, dependsOn: { deletedAt: null } },
					include: {
						dependsOn: {
							select: {
								id: true,
								title: true,
								status: true,
								departmentId: true,
							},
						},
					},
				},
				dependents: {
					where: { deletedAt: null, task: { deletedAt: null } },
					include: {
						task: {
							select: { id: true, title: true, status: true },
						},
					},
				},
				attachments: {
					where: { deletedAt: null },
					orderBy: { createdAt: "desc" },
				},
				_count: {
					select: { auditLogs: true },
				},
			},
		});

		if (!task) throw new NotFoundError("Task", taskId);

		// Calculate effective status
		const effectiveStatus = await dependencyService.getEffectiveStatus(
			task.id,
			task.status,
		);

		// Check dependency details
		const depCheck = await dependencyService.checkDependencies(task.id);

		return {
			...task,
			effectiveStatus,
			blockedBy:
				effectiveStatus === "BLOCKED" ? depCheck.pendingDependencies : [],
			dependencyStatus: {
				allDone: depCheck.allDone,
				pendingCount: depCheck.pendingCount,
				pendingDependencies: depCheck.pendingDependencies,
			},
		};
	}

	/**
	 * Create a new task (PM only)
	 */
	async create(input: CreateTaskInput, user: AuthUser) {
		if (!canUpdateTaskFields(user)) {
			throw new ForbiddenError("Only PM can create tasks");
		}

		// Verify project exists
		const project = await prisma.project.findFirst({
			where: { id: input.projectId, deletedAt: null },
		});
		if (!project) throw new NotFoundError("Project", input.projectId);

		// Verify department exists
		const department = await prisma.department.findFirst({
			where: { id: input.departmentId, deletedAt: null },
		});
		if (!department) throw new NotFoundError("Department", input.departmentId);

		// Verify assignee exists and is INTERNAL with matching department
		if (input.assigneeId) {
			const assignee = await prisma.user.findFirst({
				where: { id: input.assigneeId, deletedAt: null },
			});
			if (!assignee) throw new NotFoundError("User", input.assigneeId);
			if (assignee.role !== "INTERNAL") {
				throw new ValidationError("Assignee must be an INTERNAL user");
			}
			if (assignee.departmentId !== input.departmentId) {
				throw new ValidationError(
					"Assignee's department must match the task's department",
				);
			}
		}

		const task = await prisma.task.create({
			data: {
				projectId: input.projectId,
				title: input.title,
				description: input.description,
				departmentId: input.departmentId,
				assigneeId: input.assigneeId,
				clientVisible: input.clientVisible,
			},
			include: {
				project: { select: { id: true, name: true } },
				department: { select: { id: true, name: true, code: true } },
				assignee: {
					select: {
						id: true,
						name: true,
						email: true,
						role: true,
						position: true,
					},
				},
			},
		});

		// Create audit log for task creation
		await auditService.logChanges(task.id, user.id, [
			{ changedColumn: "created", oldValue: null, newValue: task.title },
		]);

		return task;
	}

	/**
	 * Update task fields (PM only) with optimistic locking + safe field-level merge.
	 *
	 * Concurrency strategy:
	 * 1. Row lock (SELECT ... FOR UPDATE) so no other writer can interleave.
	 * 2. If `version` matches → normal update.
	 * 3. If `version` is stale AND the client sent a `baseline` → 3-way merge:
	 *    - fields the client did not change are ignored (never overwrite others' work)
	 *    - fields the client changed that nobody else touched → merged onto latest
	 *    - fields both sides changed (to different values) → 409 with conflictingFields
	 * 4. If `version` is stale and no baseline → 409 (strict rejection).
	 *
	 * Example: PM edits description (v3) while the engineer marks the task DONE (v3→v4).
	 * Status is not an editable field here, so the PM's description is merged on top of
	 * v4 and the DONE status is preserved — neither write is lost.
	 */
	async update(taskId: string, input: UpdateTaskInput, user: AuthUser) {
		if (!canUpdateTaskFields(user)) {
			throw new ForbiddenError("Only PM can update task fields");
		}

		const updated = await prisma.$transaction(async (tx) => {
			await dependencyService.lockTasks(tx, [taskId]);

			const current = await tx.task.findFirst({
				where: { id: taskId, deletedAt: null },
			});
			if (!current) throw new NotFoundError("Task", taskId);

			const { baseline } = input;
			const isStale = current.version !== input.version;

			if (isStale && !baseline) {
				throw new VersionConflictError(current.version, {
					current: this.snapshot(current),
				});
			}

			// Determine which fields the CLIENT actually changed
			const clientChanges: Partial<Record<EditableField, unknown>> = {};
			for (const field of EDITABLE_FIELDS) {
				const next = input[field];
				if (next === undefined) continue;
				const reference =
					baseline && field in baseline ? baseline[field] : current[field];
				if (!sameValue(next, reference)) clientChanges[field] = next;
			}

			// Stale version → detect true conflicts (both sides changed the same field)
			if (isStale && baseline) {
				const conflictingFields = (
					Object.keys(clientChanges) as EditableField[]
				).filter(
					(field) =>
						!(field in baseline) ||
						(!sameValue(current[field], baseline[field]) &&
							!sameValue(current[field], clientChanges[field])),
				);
				if (conflictingFields.length > 0) {
					throw new VersionConflictError(current.version, {
						conflictingFields,
						current: this.snapshot(current),
					});
				}
			}

			// Build update data + audit entries relative to the LATEST row
			const changes: Array<{
				changedColumn: string;
				oldValue: string | null;
				newValue: string | null;
			}> = [];
			const updateData: Record<string, unknown> = {};
			for (const [field, value] of Object.entries(clientChanges) as [
				EditableField,
				unknown,
			][]) {
				if (sameValue(current[field], value)) continue; // already equal (other user made same change)
				updateData[field] = value;
				changes.push({
					changedColumn: field,
					oldValue: current[field] == null ? null : String(current[field]),
					newValue: value == null ? null : String(value),
				});
			}

			// Validate assignee ↔ department consistency on the merged result
			const finalDept =
				(updateData.departmentId as string | undefined) ?? current.departmentId;
			const finalAssignee =
				"assigneeId" in updateData
					? (updateData.assigneeId as string | null)
					: current.assigneeId;
			if ("departmentId" in updateData || "assigneeId" in updateData) {
				const dept = await tx.department.findFirst({
					where: { id: finalDept, deletedAt: null },
				});
				if (!dept) throw new NotFoundError("Department", finalDept);
				if (finalAssignee) {
					const assignee = await tx.user.findFirst({
						where: { id: finalAssignee, deletedAt: null },
					});
					if (!assignee) throw new NotFoundError("User", finalAssignee);
					if (assignee.role !== "INTERNAL") {
						throw new ValidationError("Assignee must be an INTERNAL user");
					}
					if (assignee.departmentId !== finalDept) {
						throw new ValidationError(
							"Assignee's department must match the task's department",
						);
					}
				}
			}

			if (changes.length > 0) {
				const result = await tx.task.updateMany({
					where: { id: taskId, version: current.version, deletedAt: null },
					data: { ...updateData, version: { increment: 1 } },
				});
				// Defensive: cannot happen while we hold the row lock
				if (result.count === 0) throw new VersionConflictError(current.version);

				await tx.taskAuditLog.createMany({
					data: changes.map((change) => ({
						taskId,
						userId: user.id,
						...change,
					})),
				});
			}

			const task = await tx.task.findFirst({
				where: { id: taskId },
				include: TASK_INCLUDE,
			});
			return {
				...task!,
				concurrency: {
					merged: isStale && changes.length > 0,
					baseVersion: input.version,
					appliedFields: changes.map((c) => c.changedColumn),
				},
			};
		});

		return updated;
	}

	/**
	 * Update task status — Full 3-Dimensional Access Control
	 *
	 * Flow:
	 * 1. Authentication (middleware)
	 * 2. Row locks on the task, its prerequisites and its dependents (FOR UPDATE)
	 * 3. Optimistic Locking (version / expectedStatus)
	 * 4. Role Check (Dimensi 1)
	 * 5. Department + Assignee Check (Dimensi 2)
	 * 6. Status Transition + Dependency Check (Dimensi 3) — read under the locks
	 * 7. Reopen guard: a DONE prerequisite cannot be reopened while dependents are active
	 * 8. Database write + Audit Log in the same transaction
	 */
	async updateStatus(
		taskId: string,
		input: UpdateTaskStatusInput,
		user: AuthUser,
	) {
		const newStatus = input.status as TaskStatus;

		return prisma.$transaction(async (tx) => {
			// Lock task + prerequisites + dependents in a deterministic order.
			// This serialises "start C" against "reopen A" (both lock A and C), so a task
			// can never start on top of a prerequisite that is being reopened concurrently.
			const [prereqs, dependents] = await Promise.all([
				tx.taskDependency.findMany({
					where: { taskId, deletedAt: null },
					select: { dependsOnId: true },
				}),
				tx.taskDependency.findMany({
					where: { dependsOnId: taskId, deletedAt: null },
					select: { taskId: true },
				}),
			]);
			await dependencyService.lockTasks(tx, [
				taskId,
				...prereqs.map((p) => p.dependsOnId),
				...dependents.map((d) => d.taskId),
			]);

			const task = await tx.task.findFirst({
				where: { id: taskId, deletedAt: null },
			});
			if (!task) throw new NotFoundError("Task", taskId);

			// Optimistic locking: a stale version is only acceptable when the status the
			// client based its decision on is still the current one (other fields changed).
			if (task.version !== input.version) {
				const statusUnchanged =
					input.expectedStatus !== undefined &&
					input.expectedStatus === task.status;
				if (!statusUnchanged) {
					throw new VersionConflictError(task.version, {
						conflictingFields: ["status"],
						current: this.snapshot(task),
					});
				}
			}

			// Idempotent: the requested status is already in place
			if (task.status === newStatus) {
				return this.loadWithEffectiveStatus(tx, taskId);
			}

			// Dependencies are read under the locks → no check-then-act race
			const depCheck = await dependencyService.checkDependencies(taskId, tx);

			// 3-Dimensional Permission Check
			assertCanUpdateStatus(
				user,
				{
					id: task.id,
					status: task.status,
					assigneeId: task.assigneeId,
					departmentId: task.departmentId,
					projectId: task.projectId,
				},
				newStatus,
				depCheck.allDone,
				depCheck.pendingCount,
				depCheck.pendingDependencies,
			);

			// Edge case: reopening a finished prerequisite while downstream work is active
			if (task.status === "DONE" && newStatus !== "DONE") {
				const active = await dependencyService.getActiveDependents(taskId, tx);
				if (active.length > 0) {
					throw new AppError(
						ERROR_CODES.DEPENDENTS_ACTIVE,
						409,
						`Cannot reopen this task: ${active.length} dependent task(s) already started or done (${active
							.map((t) => `"${t.title}"`)
							.join(", ")}). Revert them to TODO first.`,
						{ dependents: active },
					);
				}
			}

			const result = await tx.task.updateMany({
				where: { id: taskId, version: task.version, deletedAt: null },
				data: { status: newStatus, version: { increment: 1 } },
			});
			if (result.count === 0) throw new VersionConflictError(task.version);

			await tx.taskAuditLog.create({
				data: {
					taskId,
					userId: user.id,
					changedColumn: "status",
					oldValue: task.status,
					newValue: newStatus,
				},
			});

			return this.loadWithEffectiveStatus(tx, taskId);
		});
	}

	/** Minimal snapshot returned on 409 so the client can diff / reload */
	private snapshot(task: {
		id: string;
		title: string;
		description: string | null;
		status: TaskStatus;
		departmentId: string;
		assigneeId: string | null;
		clientVisible: boolean;
		version: number;
		updatedAt: Date;
	}) {
		return {
			id: task.id,
			title: task.title,
			description: task.description,
			status: task.status,
			departmentId: task.departmentId,
			assigneeId: task.assigneeId,
			clientVisible: task.clientVisible,
			version: task.version,
			updatedAt: task.updatedAt.toISOString(),
		};
	}

	private async loadWithEffectiveStatus(tx: TxClient, taskId: string) {
		const task = await tx.task.findFirst({
			where: { id: taskId },
			include: TASK_INCLUDE,
		});
		const effective = await dependencyService.getEffectiveStatuses([task!], tx);
		const e = effective.get(taskId);
		return {
			...task!,
			effectiveStatus: e?.effectiveStatus ?? task!.status,
			blockedBy: e?.blockedBy ?? [],
		};
	}

	/**
	 * Soft delete a task (PM only)
	 */
	async softDelete(taskId: string, user: AuthUser) {
		if (!canUpdateTaskFields(user)) {
			throw new ForbiddenError("Only PM can delete tasks");
		}

		const task = await prisma.task.findFirst({
			where: { id: taskId, deletedAt: null },
		});
		if (!task) throw new NotFoundError("Task", taskId);

		await prisma.$transaction(async (tx) => {
			await tx.task.update({
				where: { id: taskId },
				data: { deletedAt: new Date() },
			});

			await tx.taskAuditLog.create({
				data: {
					taskId,
					userId: user.id,
					changedColumn: "deletedAt",
					oldValue: null,
					newValue: new Date().toISOString(),
				},
			});
		});

		return { message: "Task deleted successfully" };
	}

	// ========================================
	// DEPENDENCY MANAGEMENT
	// ========================================

	/**
	 * Get task dependencies
	 */
	async getDependencies(taskId: string) {
		const task = await prisma.task.findFirst({
			where: { id: taskId, deletedAt: null },
		});
		if (!task) throw new NotFoundError("Task", taskId);

		return prisma.taskDependency.findMany({
			where: { taskId, deletedAt: null, dependsOn: { deletedAt: null } },
			include: {
				dependsOn: {
					select: {
						id: true,
						title: true,
						status: true,
						departmentId: true,
						department: { select: { id: true, name: true, code: true } },
					},
				},
			},
		});
	}

	/**
	 * Add a dependency (PM only)
	 *
	 * Runs in a transaction with both tasks locked, so two concurrent requests
	 * (A→B and B→A) cannot both pass the cycle check, and a task cannot be started
	 * while a new prerequisite is being attached. The dependent task's version is
	 * bumped because its "can start" state changed — stale clients get 409.
	 */
	async addDependency(taskId: string, dependsOnTaskId: string, user: AuthUser) {
		if (!canManageDependencies(user)) {
			throw new ForbiddenError("Only PM can manage dependencies");
		}

		// Validate: not self-referencing
		if (taskId === dependsOnTaskId) {
			throw new AppError(
				ERROR_CODES.SELF_DEPENDENCY,
				400,
				"A task cannot depend on itself",
			);
		}

		return prisma.$transaction(async (tx) => {
			await dependencyService.lockTasks(tx, [taskId, dependsOnTaskId]);

			const task = await tx.task.findFirst({
				where: { id: taskId, deletedAt: null },
			});
			if (!task) throw new NotFoundError("Task", taskId);

			const dependsOnTask = await tx.task.findFirst({
				where: { id: dependsOnTaskId, deletedAt: null },
			});
			if (!dependsOnTask)
				throw new NotFoundError("Dependency Task", dependsOnTaskId);

			// Validate: same project
			if (task.projectId !== dependsOnTask.projectId) {
				throw new AppError(
					ERROR_CODES.DEPENDENCY_NOT_SAME_PROJECT,
					400,
					"Dependencies must be within the same project",
				);
			}

			// Validate: no circular dependency (read under the locks)
			const isCircular = await dependencyService.detectCircularDependency(
				taskId,
				dependsOnTaskId,
				tx,
			);
			if (isCircular) {
				throw new CircularDependencyError();
			}

			// Edge case: attaching an unfinished prerequisite to work that already started
			if (task.status !== "TODO" && dependsOnTask.status !== "DONE") {
				throw new AppError(
					ERROR_CODES.DEPENDENCY_ON_STARTED_TASK,
					409,
					`"${task.title}" is already ${task.status}. An unfinished prerequisite ("${dependsOnTask.title}" is ${dependsOnTask.status}) can only be added to a TODO task.`,
				);
			}

			// Check if dependency already exists (a soft-removed link is revived instead)
			const existing = await tx.taskDependency.findUnique({
				where: {
					taskId_dependsOnId: { taskId, dependsOnId: dependsOnTaskId },
				},
			});
			if (existing && existing.deletedAt === null) {
				throw new AppError(
					ERROR_CODES.ALREADY_EXISTS,
					409,
					"Dependency already exists",
				);
			}

			const dependencyInclude = {
				dependsOn: { select: { id: true, title: true, status: true } },
			} as const;
			const dependency = existing
				? await tx.taskDependency.update({
						where: {
							taskId_dependsOnId: { taskId, dependsOnId: dependsOnTaskId },
						},
						data: { deletedAt: null },
						include: dependencyInclude,
					})
				: await tx.taskDependency.create({
						data: { taskId, dependsOnId: dependsOnTaskId },
						include: dependencyInclude,
					});

			await tx.task.update({
				where: { id: taskId },
				data: { version: { increment: 1 } },
			});

			// Audit log
			await tx.taskAuditLog.create({
				data: {
					taskId,
					userId: user.id,
					changedColumn: "dependency_added",
					oldValue: null,
					newValue: dependsOnTask.title,
				},
			});

			return dependency;
		});
	}

	/**
	 * Remove a dependency (PM only)
	 */
	async removeDependency(
		taskId: string,
		dependsOnTaskId: string,
		user: AuthUser,
	) {
		if (!canManageDependencies(user)) {
			throw new ForbiddenError("Only PM can manage dependencies");
		}

		return prisma.$transaction(async (tx) => {
			await dependencyService.lockTasks(tx, [taskId, dependsOnTaskId]);

			const existing = await tx.taskDependency.findFirst({
				where: { taskId, dependsOnId: dependsOnTaskId, deletedAt: null },
				include: { dependsOn: { select: { title: true } } },
			});
			if (!existing) throw new NotFoundError("Dependency");

			// Soft delete — the link row is kept for history
			await tx.taskDependency.update({
				where: {
					taskId_dependsOnId: { taskId, dependsOnId: dependsOnTaskId },
				},
				data: { deletedAt: new Date() },
			});

			await tx.task.update({
				where: { id: taskId },
				data: { version: { increment: 1 } },
			});

			// Audit log
			await tx.taskAuditLog.create({
				data: {
					taskId,
					userId: user.id,
					changedColumn: "dependency_removed",
					oldValue: existing.dependsOn.title,
					newValue: null,
				},
			});

			return { message: "Dependency removed successfully" };
		});
	}

	// ========================================
	// AUDIT LOGS
	// ========================================

	async getTaskAuditLogs(taskId: string, _user: AuthUser) {
		const task = await prisma.task.findFirst({
			where: { id: taskId, deletedAt: null },
		});
		if (!task) throw new NotFoundError("Task", taskId);

		return auditService.getTaskAuditLogs(taskId);
	}

	async getProjectAuditLogs(projectId: string, _user: AuthUser) {
		const project = await prisma.project.findFirst({
			where: { id: projectId, deletedAt: null },
		});
		if (!project) throw new NotFoundError("Project", projectId);

		return auditService.getProjectAuditLogs(projectId);
	}
}

export const taskService = new TaskService();
