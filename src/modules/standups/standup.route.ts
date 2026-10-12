import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { standupGenerateRateLimiter } from "../../middlewares/rate-limit.middleware";
import { internalOnly, pmOnly } from "../../middlewares/role.middleware";
import { projectService } from "../projects/project.service";
import { standupController } from "./standup.controller";

const standupRoute = new Hono();

// Standup payloads contain internal identities (engineer names, departments),
// so CLIENT is blocked at the API level, not just hidden in the UI.
standupRoute.use("*", authMiddleware, internalOnly());

// Project scoping: the caller must have access to the project (throws 403/404 otherwise)
standupRoute.use("*", async (c, next) => {
	const projectId = c.req.param("id");
	if (projectId)
		await projectService.checkProjectAccess(projectId, c.get("user"));
	await next();
});

// ── Per-project standup endpoints ────────────────────────────
// These are mounted under /projects/:id/standups in the routes index

// List standups for a project — all internal users
standupRoute.get("/", (c) => standupController.list(c));

// Get a specific standup by date
standupRoute.get("/:date", (c) => standupController.findByDate(c));

// Generate standup for a project — PM only
standupRoute.post("/generate", pmOnly(), standupGenerateRateLimiter, (c) =>
	standupController.generate(c),
);

export { standupRoute };
