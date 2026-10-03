import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { authMiddleware } from "../middlewares/auth.middleware";
import { pmOnly } from "../middlewares/role.middleware";
import { attachmentRoute } from "../modules/attachments/attachment.route";
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
import { successResponse } from "../shared/response";

const routes = new Hono();

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

// Project audit logs — all users
routes.get("/projects/:id/audit-logs", authMiddleware, (c) =>
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

// Global standup batch-generate — PM only
routes.post("/standups/generate-all", authMiddleware, pmOnly(), (c) =>
	standupController.generateAll(c),
);

// Trash & restore for soft-deleted data — PM only
routes.route("/trash", trashRoute);

// Global audit logs — PM only, for dashboard activity feed
routes.get("/audit-logs", authMiddleware, pmOnly(), async (c) => {
	const logs = await prisma.taskAuditLog.findMany({
		take: 20,
		orderBy: { createdAt: "desc" },
		include: {
			user: { select: { id: true, name: true, role: true } },
			task: {
				select: {
					id: true,
					title: true,
					status: true,
					project: { select: { id: true, name: true } },
				},
			},
		},
	});
	return successResponse(c, logs);
});

export { routes };
