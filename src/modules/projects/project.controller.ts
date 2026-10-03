import type { Context } from "hono";
import { ValidationError } from "../../shared/errors";
import { paginatedResponse, successResponse } from "../../shared/response";
import type { AuthUser } from "../../shared/types";
import { buildListQuery } from "../../shared/utils/pagination";
import { getParam } from "../../shared/utils/params";
import { createProjectSchema, updateProjectSchema } from "./project.schema";
import { projectService } from "./project.service";

export class ProjectController {
	async findAll(c: Context) {
		const user = c.get("user") as AuthUser;
		// Filtering, search, sort & pagination via @nodewave/prisma-ezfilter
		const params = buildListQuery(c.req.query(), {
			filterable: ["clientId", "createdAt"],
			searchable: ["name", "description"],
			sortable: ["createdAt", "updatedAt", "name"],
		});
		const { data, total } = await projectService.findAll(user, params);
		return paginatedResponse(c, data, {
			page: params.page,
			pageSize: params.pageSize,
			total,
		});
	}

	async findById(c: Context) {
		const user = c.get("user") as AuthUser;
		const id = getParam(c, "id");
		const project = await projectService.findById(id, user);
		return successResponse(c, project);
	}

	async create(c: Context) {
		const user = c.get("user") as AuthUser;
		const body = await c.req.json();
		const parsed = createProjectSchema.safeParse(body);
		if (!parsed.success) {
			throw new ValidationError(
				"Validation failed",
				parsed.error.flatten().fieldErrors,
			);
		}
		const project = await projectService.create(parsed.data, user.id);
		return successResponse(c, project, 201);
	}

	async update(c: Context) {
		const id = getParam(c, "id");
		const body = await c.req.json();
		const parsed = updateProjectSchema.safeParse(body);
		if (!parsed.success) {
			throw new ValidationError(
				"Validation failed",
				parsed.error.flatten().fieldErrors,
			);
		}
		const project = await projectService.update(id, parsed.data);
		return successResponse(c, project);
	}

	async delete(c: Context) {
		const id = getParam(c, "id");
		await projectService.softDelete(id);
		return successResponse(c, { message: "Project deleted successfully" });
	}

	async addDepartment(c: Context) {
		const projectId = getParam(c, "id");
		const body = await c.req.json();
		const departmentId = body.departmentId;
		if (!departmentId) {
			throw new ValidationError("Validation failed", {
				departmentId: ["Required"],
			});
		}
		const dept = await projectService.addDepartment(projectId, departmentId);
		return successResponse(c, dept, 201);
	}

	async removeDepartment(c: Context) {
		const projectId = getParam(c, "id");
		const departmentId = getParam(c, "departmentId");
		await projectService.removeDepartment(projectId, departmentId);
		return successResponse(c, { message: "Department removed successfully" });
	}
}

export const projectController = new ProjectController();
