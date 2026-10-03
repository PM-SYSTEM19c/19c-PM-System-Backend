import { Hono } from "hono";
import { departmentController } from "./department.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { pmOnly, internalOnly } from "../../middlewares/role.middleware";

const departmentRoute = new Hono();

// All department routes require auth + PM role
// CLIENT role is blocked entirely: internal identities must never reach clients (masking at API level).
departmentRoute.use("*", authMiddleware, internalOnly());

departmentRoute.get("/", (c) => departmentController.findAll(c));
departmentRoute.get("/:id", (c) => departmentController.findById(c));
departmentRoute.post("/", pmOnly(), (c) => departmentController.create(c));
departmentRoute.patch("/:id", pmOnly(), (c) => departmentController.update(c));
departmentRoute.delete("/:id", pmOnly(), (c) => departmentController.delete(c));

export { departmentRoute };
