import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { internalOnly, pmOnly } from "../../middlewares/role.middleware";
import { positionController } from "./position.controller";

const positionRoute = new Hono();

// CLIENT role is blocked entirely: internal identities must never reach clients (masking at API level).
positionRoute.use("*", authMiddleware, internalOnly());

positionRoute.get("/", (c) => positionController.getAll(c));
positionRoute.post("/", pmOnly(), (c) => positionController.create(c));
positionRoute.patch("/:id", pmOnly(), (c) => positionController.update(c));
positionRoute.delete("/:id", pmOnly(), (c) => positionController.delete(c));

export { positionRoute };
