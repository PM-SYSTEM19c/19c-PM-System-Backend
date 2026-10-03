import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { clientController } from "./client.controller";

const clientRoute = new Hono();

// All client routes require auth + CLIENT role
clientRoute.use("*", authMiddleware, requireRole("CLIENT" as any));

clientRoute.get("/projects", (c) => clientController.getProjects(c));
clientRoute.get("/projects/:id", (c) => clientController.getProjectById(c));
clientRoute.get("/projects/:id/tasks", (c) =>
	clientController.getProjectTasks(c),
);

export { clientRoute };
