import type { Context } from "hono";
import { ForbiddenError, ValidationError } from "../../shared/errors";
import { paginatedResponse, successResponse } from "../../shared/response";
import type { AuthUser } from "../../shared/types";
import { buildListQuery } from "../../shared/utils/pagination";
import { getParam } from "../../shared/utils/params";
import { updateUserSchema } from "./user.schema";
import { userService } from "./user.service";

export class UserController {
	async findAll(c: Context) {
		const params = buildListQuery(c.req.query(), {
			filterable: ["role", "departmentId", "positionId", "status"],
			searchable: ["name", "email"],
			sortable: ["createdAt", "name", "email", "role"],
		});

		const { data, total } = await userService.findAll(params);
		return paginatedResponse(c, data, {
			page: params.page,
			pageSize: params.pageSize,
			total,
		});
	}

	async findById(c: Context) {
		const id = getParam(c, "id");
		const current = c.get("user") as AuthUser;
		if (current.role !== "PM" && current.id !== id) {
			throw new ForbiddenError("You can only view your own profile");
		}
		const user = await userService.findById(id);
		return successResponse(c, user);
	}

	async update(c: Context) {
		const id = getParam(c, "id");
		const body = await c.req.json().catch(() => ({}));
		const parsed = updateUserSchema.safeParse(body);

		if (!parsed.success) {
			throw new ValidationError(
				"Validation failed",
				parsed.error.flatten().fieldErrors,
			);
		}

		const data = parsed.data;
		const updateData: any = {};
		if (data.name !== undefined) updateData.name = data.name;
		if (data.departmentId !== undefined)
			updateData.departmentId = data.departmentId;
		if (data.role !== undefined) updateData.role = data.role;
		if (data.status !== undefined) updateData.status = data.status;
		if (data.positionId !== undefined) updateData.positionId = data.positionId;
		else if (data.position !== undefined) updateData.positionId = data.position;

		const updated = await userService.update(id, updateData);
		return successResponse(c, updated);
	}
}

export const userController = new UserController();
