import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { pmOnly } from "../../middlewares/role.middleware";
import { AppError } from "../../shared/errors";
import { successResponse } from "../../shared/response";
import { getParam } from "../../shared/utils/params";
import { TRASH_TYPES, type TrashType, trashService } from "./trash.service";

const trashRoute = new Hono();

// Only the PM can see and restore deleted data
trashRoute.use("*", authMiddleware, pmOnly());

// GET /trash — everything currently soft-deleted, grouped by type
trashRoute.get("/", async (c) => {
	return successResponse(c, await trashService.list());
});

// POST /trash/:type/:id/restore
trashRoute.post("/:type/:id/restore", async (c) => {
	const type = getParam(c, "type");
	if (!TRASH_TYPES.includes(type as TrashType)) {
		throw new AppError(
			"VALIDATION_ERROR",
			400,
			`type must be one of: ${TRASH_TYPES.join(", ")}`,
		);
	}
	const restored = await trashService.restore(
		type as TrashType,
		getParam(c, "id"),
		c.get("user"),
	);
	return successResponse(c, restored);
});

export { trashRoute };
