import type { Context } from "hono";
import { AppError } from "../../shared/errors";
import { successResponse } from "../../shared/response";
import { getParam } from "../../shared/utils/params";
import { standupService } from "./standup.service";

export class StandupController {
	/**
	 * POST /projects/:id/standups/generate
	 * Generate (or force-regenerate) a daily standup summary.
	 *
	 * Query params:
	 *   date  — YYYY-MM-DD (defaults to yesterday)
	 *   force — "true" to regenerate even if already exists
	 */
	async generate(c: Context) {
		const projectId = getParam(c, "id");
		const date = c.req.query("date") ?? undefined;
		const force = c.req.query("force") === "true";

		// Validate date format if provided
		if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			throw new AppError(
				"VALIDATION_ERROR",
				400,
				"date must be in YYYY-MM-DD format",
			);
		}

		const payload = await standupService.generate(projectId, date, force);
		return successResponse(c, payload, 201);
	}

	/**
	 * GET /projects/:id/standups/:date
	 * Retrieve a previously generated standup by date.
	 */
	async findByDate(c: Context) {
		const projectId = getParam(c, "id");
		const date = getParam(c, "date");

		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			throw new AppError(
				"VALIDATION_ERROR",
				400,
				"date must be in YYYY-MM-DD format",
			);
		}

		const payload = await standupService.findByProjectAndDate(projectId, date);
		if (!payload) {
			throw new AppError(
				"NOT_FOUND",
				404,
				`No standup summary found for project ${projectId} on ${date}`,
			);
		}
		return successResponse(c, payload);
	}

	/**
	 * GET /projects/:id/standups
	 * List all standups for a project (summary only).
	 */
	async list(c: Context) {
		const projectId = getParam(c, "id");
		const limit = parseInt(c.req.query("limit") ?? "30", 10);

		const standups = await standupService.listByProject(projectId, limit);
		return successResponse(c, standups);
	}

	/**
	 * POST /standups/generate-all
	 * Batch-generate standups for ALL active projects (cron / admin endpoint).
	 */
	async generateAll(c: Context) {
		const date = c.req.query("date") ?? undefined;
		const force = c.req.query("force") === "true";

		if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			throw new AppError(
				"VALIDATION_ERROR",
				400,
				"date must be in YYYY-MM-DD format",
			);
		}

		const results = await standupService.generateForAllProjects(date, force);
		return successResponse(c, results, 201);
	}
}

export const standupController = new StandupController();
