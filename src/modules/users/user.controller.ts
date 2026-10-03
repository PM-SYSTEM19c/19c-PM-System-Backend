import type { Context } from "hono";
import { paginatedResponse, successResponse } from "../../shared/response";
import { buildListQuery } from "../../shared/utils/pagination";
import { getParam } from "../../shared/utils/params";
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
		const user = await userService.findById(id);
		return successResponse(c, user);
	}

	async update(c: Context) {
		const id = getParam(c, "id");
		const body = await c.req.json();

		const updateData: any = {};
		if (body.name) updateData.name = body.name;
		if (body.departmentId !== undefined)
			updateData.departmentId = body.departmentId;
		if (body.role) updateData.role = body.role;
		if (body.status) updateData.status = body.status;
		if (body.positionId !== undefined) updateData.positionId = body.positionId;
		else if (body.position !== undefined) updateData.positionId = body.position;

		const updated = await userService.update(id, updateData);
		return successResponse(c, updated);
	}
}

export const userController = new UserController();
