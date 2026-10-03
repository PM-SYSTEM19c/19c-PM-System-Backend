import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { internalOnly, pmOnly } from "../../middlewares/role.middleware";
import { positionController } from "./position.controller";

const positionRoute = new Hono();

// CLIENT role is blocked entirely: internal identities must never reach clients (masking at API level).
positionRoute.use("*", authMiddleware, internalOnly());

positionRoute.get("/", positionController.getAll);
positionRoute.post("/", pmOnly(), positionController.create);
positionRoute.patch("/:id", pmOnly(), positionController.update);
positionRoute.delete("/:id", pmOnly(), positionController.delete);

export { positionRoute };
