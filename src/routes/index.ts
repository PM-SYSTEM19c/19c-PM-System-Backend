import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { authMiddleware } from "../middlewares/auth.middleware";
import { batchStandupRateLimiter } from "../middlewares/rate-limit.middleware";
import { internalOnly, pmOnly } from "../middlewares/role.middleware";
import { attachmentRoute } from "../modules/attachments/attachment.route";
import { authRoute } from "../modules/auth/auth.route";
import { clientRoute } from "../modules/client/client.route";
import { departmentRoute } from "../modules/departments/department.route";
import { positionRoute } from "../modules/positions/position.route";
import { projectRoute } from "../modules/projects/project.route";
import { projectService } from "../modules/projects/project.service";
import { standupController } from "../modules/standups/standup.controller";
import { standupRoute } from "../modules/standups/standup.route";
import { taskController } from "../modules/tasks/task.controller";
import { taskRoute } from "../modules/tasks/task.route";
import { trashRoute } from "../modules/trash/trash.route";
import { userRoute } from "../modules/users/user.route";
import { NotFoundError } from "../shared/errors";
import { successResponse } from "../shared/response";
import type { AuthUser } from "../shared/types";

const routes = new Hono();

// Secure physical attachment file retrieval (SEC-001 & SEC-002)
routes.get("/uploads/:fileName", authMiddleware, internalOnly(), async (c) => {
	const user = c.get("user") as AuthUser;
	const rawFileName = c.req.param("fileName");
	if (!rawFileName) {
		throw new NotFoundError("Attachment", "unknown");
	}

	// 1. Prevent path traversal attacks
	const fileName = path.basename(rawFileName);
	if (!fileName || fileName !== rawFileName) {
		throw new NotFoundError("Attachment", rawFileName);
	}

	// 2. Lookup task attachment in database
	const attachment = await prisma.taskAttachment.findFirst({
		where: {
			fileUrl: { endsWith: `/${fileName}` },
			deletedAt: null,
		},
		include: {
			task: {
				select: {
					id: true,
					projectId: true,
					deletedAt: true,
				},
			},
		},
	});

	if (!attachment || attachment.task.deletedAt !== null) {
		throw new NotFoundError("Attachment", fileName);
	}

	// 3. Check project access using existing projectService.checkProjectAccess
	// PM: always allowed
	// CLIENT: blocked by internalOnly()
	// INTERNAL: checks project_departments assignment
	await projectService.checkProjectAccess(attachment.task.projectId, user);

	// 4. Verify physical file on disk
	const filePath = path.resolve(process.cwd(), "uploads", fileName);
	try {
		const stat = await fs.stat(filePath);
		if (!stat.isFile()) {
			throw new NotFoundError("File", fileName);
		}
	} catch {
		throw new NotFoundError("File", fileName);
	}

	// 5. Stream file with secure headers
	const fileBuffer = await fs.readFile(filePath);
	const mimeType = attachment.mimeType || "application/octet-stream";

	c.header("Content-Type", mimeType);
	c.header("Content-Length", fileBuffer.length.toString());
	c.header(
		"Content-Disposition",
		`inline; filename="${encodeURIComponent(attachment.fileName || fileName)}"`,
	);
	c.header("Cache-Control", "private, no-cache, no-store, must-revalidate");
	c.header("X-Content-Type-Options", "nosniff");

	return c.body(fileBuffer);
});

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
