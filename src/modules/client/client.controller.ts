import type { Context } from "hono";
import { successResponse } from "../../shared/response";
import type { AuthUser } from "../../shared/types";
import { getParam } from "../../shared/utils/params";
import { clientService } from "./client.service";

export class ClientController {
	async getProjects(c: Context) {
		const user = c.get("user") as AuthUser;
		const projects = await clientService.getProjects(user.id);
		return successResponse(c, projects);
	}

	async getProjectById(c: Context) {
		const user = c.get("user") as AuthUser;
		const id = getParam(c, "id");
		const project = await clientService.getProjectById(id, user.id);
		return successResponse(c, project);
	}

	async getProjectTasks(c: Context) {
		const user = c.get("user") as AuthUser;
		const id = getParam(c, "id");
		const tasks = await clientService.getProjectTasks(id, user.id);
		return successResponse(c, tasks);
	}
}

export const clientController = new ClientController();
