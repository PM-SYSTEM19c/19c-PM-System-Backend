import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { pmOnly } from "../../middlewares/role.middleware";
import { userController } from "./user.controller";

const userRoute = new Hono();

userRoute.use("*", authMiddleware);

// GET /users — PM only, with search, filter, pagination
userRoute.get("/", pmOnly(), (c) => userController.findAll(c));

// GET /users/:id — PM or authorized user
userRoute.get("/:id", (c) => userController.findById(c));

// PATCH /users/:id — PM only
userRoute.patch("/:id", pmOnly(), (c) => userController.update(c));

export { userRoute };
