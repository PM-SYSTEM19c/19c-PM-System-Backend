import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
	batchStandupRateLimiter,
	downloadRateLimiter,
} from "../middlewares/rate-limit.middleware";
import { internalOnly, pmOnly } from "../middlewares/role.middleware";
import { attachmentRoute } from "../modules/attachments/attachment.route";
import { attachmentService } from "../modules/attachments/attachment.service";
import { authRoute } from "../modules/auth/auth.route";
import { clientRoute } from "../modules/client/client.route";
import { departmentRoute } from "../modules/departments/department.route";
import { positionRoute } from "../modules/positions/position.route";
import { projectRoute } from "../modules/projects/project.route";
import { standupController } from "../modules/standups/standup.controller";
import { standupRoute } from "../modules/standups/standup.route";
import { taskController } from "../modules/tasks/task.controller";
import { taskRoute } from "../modules/tasks/task.route";
import { trashRoute } from "../modules/trash/trash.route";
import { userRoute } from "../modules/users/user.route";
import type { AuthUser } from "../shared/types";

const routes = new Hono();

// Secure physical attachment file retrieval (SEC-001 & SEC-002)
routes.get(
	"/uploads/:fileName",
	authMiddleware,
	internalOnly(),
	downloadRateLimiter,
	async (c) => {
		const user = c.get("user") as AuthUser;
		const rawFileName = c.req.param("fileName");
		const file = await attachmentService.getPhysicalAttachment(
			rawFileName,
			user,
		);

		c.header("Content-Type", file.mimeType);
		c.header("Content-Length", file.buffer.length.toString());
		c.header(
			"Content-Disposition",
			`inline; filename="${encodeURIComponent(file.fileName)}"`,
		);
		c.header("Cache-Control", "private, no-cache, no-store, must-revalidate");
		c.header("X-Content-Type-Options", "nosniff");

		return c.body(file.buffer as any);
	},
);

// Auth (public + protected)
routes.route("/auth", authRoute);

// Departments (authenticated)
routes.route("/departments", departmentRoute);

// Positions (authenticated)
routes.route("/positions", positionRoute);

// Users (authenticated, PM for list)
routes.route("/users", userRoute);

// Projects (authenticated, scoped by role)
routes.route("/projects", projectRoute);

// Project audit logs — internal users only (CLIENT blocked from internal audit logs)
routes.get("/projects/:id/audit-logs", authMiddleware, internalOnly(), (c) =>
	taskController.getProjectAuditLogs(c),
);

// Tasks (authenticated, 3-dim access control)
routes.route("/tasks", taskRoute);

// Task attachments (nested under /tasks/:id/attachments)
routes.route("/tasks", attachmentRoute);

// Client dedicated endpoints
routes.route("/client", clientRoute);

// Per-project standup endpoints: /projects/:id/standups/*
routes.route("/projects/:id/standups", standupRoute);

// Global standup batch-generate — PM only (rate-limited for heavy batch operation)
routes.post(
	"/standups/generate-all",
	authMiddleware,
	pmOnly(),
	batchStandupRateLimiter,
	(c) => standupController.generateAll(c),
);

// Trash & restore for soft-deleted data — PM only
routes.route("/trash", trashRoute);

// Global audit logs — PM only, for dashboard activity feed
routes.get("/audit-logs", authMiddleware, pmOnly(), (c) =>
	taskController.getGlobalAuditLogs(c),
);

export { routes };
