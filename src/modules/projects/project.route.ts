import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { internalOnly, pmOnly } from "../../middlewares/role.middleware";
import { projectController } from "./project.controller";

const projectRoute = new Hono();

// CLIENT role is blocked entirely: internal identities must never reach clients (masking at API level).
projectRoute.use("*", authMiddleware, internalOnly());

// List & Detail — all authenticated users (scoped by role)
projectRoute.get("/", (c) => projectController.findAll(c));
projectRoute.get("/:id", (c) => projectController.findById(c));

// Create, Update, Delete — PM only
projectRoute.post("/", pmOnly(), (c) => projectController.create(c));
projectRoute.patch("/:id", pmOnly(), (c) => projectController.update(c));
projectRoute.delete("/:id", pmOnly(), (c) => projectController.delete(c));

// Department management — PM only
projectRoute.post("/:id/departments", pmOnly(), (c) =>
	projectController.addDepartment(c),
);
projectRoute.delete("/:id/departments/:departmentId", pmOnly(), (c) =>
	projectController.removeDepartment(c),
);

export { projectRoute };
