import type { Context } from "hono";
import { ValidationError } from "../../shared/errors";
import { paginatedResponse, successResponse } from "../../shared/response";
import type { AuthUser } from "../../shared/types";
import { buildListQuery } from "../../shared/utils/pagination";
import { getParam } from "../../shared/utils/params";
import {
	addDependencySchema,
	createTaskSchema,
	updateTaskSchema,
	updateTaskStatusSchema,
} from "./task.schema";
import { taskService } from "./task.service";

export class TaskController {
	// ========================================
	// TASK CRUD
	// ========================================

	async findAll(c: Context) {
		const user = c.get("user") as AuthUser;
		// Filtering, search, sort & pagination via @nodewave/prisma-ezfilter
		const params = buildListQuery(c.req.query(), {
			filterable: [
				"status",
				"departmentId",
				"assigneeId",
				"projectId",
				"clientVisible",
				"createdAt",
			],
			searchable: ["title", "description"],
			sortable: ["createdAt", "updatedAt", "title", "status"],
		});
		const { data, total } = await taskService.findAll(user, params);
		return paginatedResponse(c, data, {
			page: params.page,
			pageSize: params.pageSize,
			total,
		});
	}

	async findById(c: Context) {
		const user = c.get("user") as AuthUser;
		const id = getParam(c, "id");
		const task = await taskService.findById(id, user);
		return successResponse(c, task);
	}

	async create(c: Context) {
		const user = c.get("user") as AuthUser;
		const body = await c.req.json();
		const parsed = createTaskSchema.safeParse(body);
		if (!parsed.success) {
			throw new ValidationError(
				"Validation failed",
				parsed.error.flatten().fieldErrors,
			);
		}
		const task = await taskService.create(parsed.data, user);
		return successResponse(c, task, 201);
	}

	async update(c: Context) {
		const user = c.get("user") as AuthUser;
		const id = getParam(c, "id");
		const body = await c.req.json();
		const parsed = updateTaskSchema.safeParse(body);
		if (!parsed.success) {
			throw new ValidationError(
				"Validation failed",
				parsed.error.flatten().fieldErrors,
			);
		}
		const task = await taskService.update(id, parsed.data, user);
		return successResponse(c, task);
	}

	async delete(c: Context) {
		const user = c.get("user") as AuthUser;
		const id = getParam(c, "id");
		const result = await taskService.softDelete(id, user);
		return successResponse(c, result);
	}

	// ========================================
	// STATUS UPDATE — 3-Dimensional Access Control
	// ========================================

	async updateStatus(c: Context) {
		const user = c.get("user") as AuthUser;
		const id = getParam(c, "id");
		const body = await c.req.json();
		const parsed = updateTaskStatusSchema.safeParse(body);
		if (!parsed.success) {
			throw new ValidationError(
				"Validation failed",
				parsed.error.flatten().fieldErrors,
			);
		}
		const task = await taskService.updateStatus(id, parsed.data, user);
		return successResponse(c, task);
	}

	// ========================================
	// DEPENDENCIES
	// ========================================

	async getDependencies(c: Context) {
		const id = getParam(c, "id");
		const dependencies = await taskService.getDependencies(id);
		return successResponse(c, dependencies);
	}

	async addDependency(c: Context) {
		const user = c.get("user") as AuthUser;
		const id = getParam(c, "id");
		const body = await c.req.json();
		const parsed = addDependencySchema.safeParse(body);
		if (!parsed.success) {
			throw new ValidationError(
				"Validation failed",
				parsed.error.flatten().fieldErrors,
			);
		}
		const dependency = await taskService.addDependency(
			id,
			parsed.data.dependsOnTaskId,
			user,
		);
		return successResponse(c, dependency, 201);
	}

	async removeDependency(c: Context) {
		const user = c.get("user") as AuthUser;
		const taskId = getParam(c, "id");
		const dependencyId = getParam(c, "dependencyId");
		const result = await taskService.removeDependency(
			taskId,
			dependencyId,
			user,
		);
		return successResponse(c, result);
	}

	// ========================================
	// AUDIT LOGS
	// ========================================

	async getTaskAuditLogs(c: Context) {
		const user = c.get("user") as AuthUser;
		const id = getParam(c, "id");
		const logs = await taskService.getTaskAuditLogs(id, user);
		return successResponse(c, logs);
	}

	async getProjectAuditLogs(c: Context) {
		const user = c.get("user") as AuthUser;
		const projectId = getParam(c, "id");
		const logs = await taskService.getProjectAuditLogs(projectId, user);
		return successResponse(c, logs);
	}
}

export const taskController = new TaskController();
