import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { internalOnly, pmOnly } from "../../middlewares/role.middleware";
import { taskController } from "./task.controller";

const taskRoute = new Hono();

// CLIENT role is blocked entirely: internal identities must never reach clients (masking at API level).
taskRoute.use("*", authMiddleware, internalOnly());

// Task CRUD
taskRoute.get("/", (c) => taskController.findAll(c));
taskRoute.get("/:id", (c) => taskController.findById(c));
taskRoute.post("/", pmOnly(), (c) => taskController.create(c));
taskRoute.patch("/:id", pmOnly(), (c) => taskController.update(c));
taskRoute.delete("/:id", pmOnly(), (c) => taskController.delete(c));

// Status update — any authenticated non-client (3-dim check in service)
taskRoute.patch("/:id/status", internalOnly(), (c) =>
	taskController.updateStatus(c),
);

// Dependencies
taskRoute.get("/:id/dependencies", (c) => taskController.getDependencies(c));
taskRoute.post("/:id/dependencies", pmOnly(), (c) =>
	taskController.addDependency(c),
);
taskRoute.delete("/:id/dependencies/:dependencyId", pmOnly(), (c) =>
	taskController.removeDependency(c),
);

// Audit logs
taskRoute.get("/:id/audit-logs", (c) => taskController.getTaskAuditLogs(c));

export { taskRoute };
