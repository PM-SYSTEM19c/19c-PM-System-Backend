import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { internalOnly, pmOnly } from "../../middlewares/role.middleware";
import { userController } from "./user.controller";

const userRoute = new Hono();

userRoute.use("*", authMiddleware);

// GET /users — PM only, with search, filter, pagination
userRoute.get("/", pmOnly(), (c) => userController.findAll(c));

// GET /users/:id — PM (any user) or the user themself.
// CLIENT is blocked: internal identities must never reach clients (masking at API level).
userRoute.get("/:id", internalOnly(), (c) => userController.findById(c));

// PATCH /users/:id — PM only
userRoute.patch("/:id", pmOnly(), (c) => userController.update(c));

export { userRoute };
