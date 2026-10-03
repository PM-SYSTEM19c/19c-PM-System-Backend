import type { Context } from "hono";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../shared/response";
import { getParam } from "../../shared/utils/params";

export const positionController = {
	async getAll(c: Context) {
		try {
			const positions = await prisma.position.findMany({
				where: { deletedAt: null },
				orderBy: { name: "asc" },
			});
			return successResponse(c, positions);
		} catch (err: any) {
			return errorResponse(c, "INTERNAL_ERROR", err.message, 500);
		}
	},

	async create(c: Context) {
		try {
			const body = await c.req.json();
			if (!body.name)
				return errorResponse(c, "VALIDATION_ERROR", "Name is required", 400);

			const pos = await prisma.position.create({
				data: { name: body.name, description: body.description },
			});
			return successResponse(c, pos, 201);
		} catch (err: any) {
			return errorResponse(c, "INTERNAL_ERROR", err.message, 500);
		}
	},

	async update(c: Context) {
		try {
			const id = getParam(c, "id");
			const body = await c.req.json();

			const pos = await prisma.position.update({
				where: { id },
				data: { name: body.name, description: body.description },
			});
			return successResponse(c, pos);
		} catch (err: any) {
			return errorResponse(c, "INTERNAL_ERROR", err.message, 500);
		}
	},

	async delete(c: Context) {
		try {
			const id = getParam(c, "id");
			await prisma.position.update({
				where: { id },
				data: { deletedAt: new Date() },
			});
			return successResponse(c, { deleted: true });
		} catch (err: any) {
			return errorResponse(c, "INTERNAL_ERROR", err.message, 500);
		}
	},
};
