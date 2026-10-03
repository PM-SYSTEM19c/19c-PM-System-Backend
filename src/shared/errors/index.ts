import { ERROR_CODES } from "../../config/constants";

export class AppError extends Error {
	constructor(
		public code: string,
		public statusCode: number,
		message: string,
		public details?: unknown,
	) {
		super(message);
		this.name = "AppError";
	}
}

// Factory methods for common errors
export class NotFoundError extends AppError {
	constructor(resource: string, id?: string) {
		super(
			ERROR_CODES.NOT_FOUND,
			404,
			id ? `${resource} with id '${id}' not found` : `${resource} not found`,
		);
	}
}

export class UnauthorizedError extends AppError {
	constructor(message: string = "Authentication required") {
		super(ERROR_CODES.UNAUTHORIZED, 401, message);
	}
}

export class ForbiddenError extends AppError {
	constructor(
		message: string = "You don't have permission to perform this action",
	) {
		super(ERROR_CODES.FORBIDDEN, 403, message);
	}
}

export class ValidationError extends AppError {
	constructor(message: string, details?: unknown) {
		super(ERROR_CODES.VALIDATION_ERROR, 400, message, details);
	}
}

export class ConflictError extends AppError {
	constructor(code: string, message: string, details?: unknown) {
		super(code, 409, message, details);
	}
}

export interface VersionConflictDetails {
	currentVersion: number;
	/** Fields that both the client and another user changed (cannot be auto-merged) */
	conflictingFields?: string[];
	/** Latest server-side snapshot so the client can show a diff / reload */
	current?: Record<string, unknown>;
}

export class VersionConflictError extends ConflictError {
	constructor(
		currentVersion: number,
		extra?: Omit<VersionConflictDetails, "currentVersion">,
	) {
		super(
			ERROR_CODES.VERSION_CONFLICT,
			extra?.conflictingFields?.length
				? `Task has been modified by another user (conflicting fields: ${extra.conflictingFields.join(", ")}).`
				: "Task has been modified by another user.",
			{ currentVersion, ...extra } satisfies VersionConflictDetails,
		);
	}
}

export class CircularDependencyError extends ConflictError {
	constructor() {
		super(
			ERROR_CODES.CIRCULAR_DEPENDENCY,
			"Creating this dependency would create a circular dependency.",
		);
	}
}

export class TaskBlockedError extends AppError {
	constructor(pendingCount: number) {
		super(
			ERROR_CODES.TASK_BLOCKED,
			409,
			`Task cannot be started because ${pendingCount} ${pendingCount === 1 ? "dependency is" : "dependencies are"} incomplete.`,
		);
	}
}
