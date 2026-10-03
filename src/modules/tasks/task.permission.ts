import type { TaskStatus } from "@prisma/client";
import { ERROR_CODES } from "../../config/constants";
import { AppError, ForbiddenError } from "../../shared/errors";
import type { AuthUser } from "../../shared/types";

/**
 * Task Permission Engine — Implements 3-Dimensional Access Control
 *
 * Dimension 1: Role (Siapa?) — PM, INTERNAL, CLIENT
 * Dimension 2: Department (Dari tim mana?) — via departmentId relation
 * Dimension 3: Task Status (Status tugas saat ini?) — TODO, IN_PROGRESS, DONE, BLOCKED
 */

interface TaskContext {
	id: string;
	status: TaskStatus;
	assigneeId: string | null;
	departmentId: string;
	projectId: string;
}

/**
 * Check if user can view a task
 */
export function canViewTask(user: AuthUser, task: TaskContext): boolean {
	if (user.role === "PM") return true;
	if (user.role === "CLIENT") return false; // Clients use dedicated /client endpoints
	// INTERNAL: must be in same department or be assignee
	if (user.role === "INTERNAL") {
		return (
			user.departmentId === task.departmentId || user.id === task.assigneeId
		);
	}
	return false;
}

/**
 * Check if user can update task fields (title, description, etc.)
 * Only PM can modify task fields
 */
export function canUpdateTaskFields(user: AuthUser): boolean {
	return user.role === "PM";
}

/**
 * Check if user can update task status — Full 3-Dimension Check
 *
 * Returns void if allowed, throws error if not
 */
export function assertCanUpdateStatus(
	user: AuthUser,
	task: TaskContext,
	newStatus: TaskStatus,
	allDependenciesDone: boolean,
	pendingDependencyCount: number,
	pendingDependencies: Array<{
		id: string;
		title: string;
		status: TaskStatus;
	}> = [],
): void {
	// Dimension 1: Role Check
	if (user.role === "CLIENT") {
		throw new ForbiddenError("Clients cannot modify tasks");
	}

	// Dimension 2: Department Check (for INTERNAL)
	if (user.role === "INTERNAL") {
		if (user.departmentId !== task.departmentId) {
			throw new AppError(
				ERROR_CODES.DEPARTMENT_MISMATCH,
				403,
				"You can only update tasks in your own department",
			);
		}

		if (task.assigneeId !== user.id) {
			throw new AppError(
				ERROR_CODES.NOT_ASSIGNEE,
				403,
				"You can only update tasks assigned to you",
			);
		}
	}

	// Dimension 3: Status Transition Validation
	const currentStatus = task.status;

	// Rule: TODO → DONE is never allowed
	if (currentStatus === "TODO" && newStatus === "DONE") {
		throw new AppError(
			ERROR_CODES.INVALID_STATUS_TRANSITION,
			400,
			"Cannot move task directly from TODO to DONE. Task must go through IN_PROGRESS first.",
		);
	}

	// Rule: IN_PROGRESS → DONE — only executor (assignee) can complete
	if (currentStatus === "IN_PROGRESS" && newStatus === "DONE") {
		if (task.assigneeId !== user.id) {
			throw new AppError(
				ERROR_CODES.EXECUTOR_ONLY,
				403,
				"Only the assigned executor can complete a task",
			);
		}
	}

	// Rule: Starting a task (TODO/BLOCKED → IN_PROGRESS) requires all dependencies DONE
	if (newStatus === "IN_PROGRESS" && currentStatus === "TODO") {
		if (!allDependenciesDone) {
			throw new AppError(
				ERROR_CODES.TASK_BLOCKED,
				409,
				`Task cannot be started because ${pendingDependencyCount} ${
					pendingDependencyCount === 1 ? "dependency is" : "dependencies are"
				} incomplete${
					pendingDependencies.length
						? `: ${pendingDependencies.map((d) => `"${d.title}" (${d.status})`).join(", ")}`
						: ""
				}.`,
				{ blockedBy: pendingDependencies },
			);
		}
	}

	// Rule: Reopening a completed task (DONE → IN_PROGRESS) — PM or executor can do this
	if (currentStatus === "DONE" && newStatus === "IN_PROGRESS") {
		if (user.role === "INTERNAL" && task.assigneeId !== user.id) {
			throw new ForbiddenError(
				"Only the assignee or PM can reopen a completed task",
			);
		}
	}

	// Rule: Rolling back (IN_PROGRESS → TODO) — PM or executor
	if (currentStatus === "IN_PROGRESS" && newStatus === "TODO") {
		if (user.role === "INTERNAL" && task.assigneeId !== user.id) {
			throw new ForbiddenError("Only the assignee or PM can roll back a task");
		}
	}
}

/**
 * Check if user can manage dependencies (add/remove)
 * Only PM can manage dependencies
 */
export function canManageDependencies(user: AuthUser): boolean {
	return user.role === "PM";
}

/**
 * Check if user can upload attachments
 * PM and INTERNAL (same department) can upload
 */
export function canUploadAttachment(
	user: AuthUser,
	task: TaskContext,
): boolean {
	if (user.role === "PM") return true;
	if (user.role === "INTERNAL") {
		return user.departmentId === task.departmentId;
	}
	return false;
}
