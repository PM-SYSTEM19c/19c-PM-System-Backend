import type { Context } from "hono";
import { ValidationError } from "../../shared/errors";
import { successResponse } from "../../shared/response";
import { getParam } from "../../shared/utils/params";
import { createPositionSchema, updatePositionSchema } from "./position.schema";
import { positionService } from "./position.service";

export class PositionController {
	async getAll(c: Context) {
		const positions = await positionService.findAll();
		return successResponse(c, positions);
	}

	async create(c: Context) {
		const body = await c.req.json();
		const parsed = createPositionSchema.safeParse(body);
		if (!parsed.success) {
			throw new ValidationError(
				"Validation failed",
				parsed.error.flatten().fieldErrors,
			);
		}
		const pos = await positionService.create(parsed.data);
		return successResponse(c, pos, 201);
	}

	async update(c: Context) {
		const id = getParam(c, "id");
		const body = await c.req.json();
		const parsed = updatePositionSchema.safeParse(body);
		if (!parsed.success) {
			throw new ValidationError(
				"Validation failed",
				parsed.error.flatten().fieldErrors,
			);
		}
		const pos = await positionService.update(id, parsed.data);
		return successResponse(c, pos);
	}

	async delete(c: Context) {
		const id = getParam(c, "id");
		await positionService.softDelete(id);
		return successResponse(c, { deleted: true });
	}
}

export const positionController = new PositionController();
