import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { authController } from "./auth.controller";

const authRoute = new Hono();

// Public routes
authRoute.post("/register", (c) => authController.register(c));
authRoute.post("/login", (c) => authController.login(c));

// Protected routes
authRoute.post("/logout", authMiddleware, (c) => authController.logout(c));
authRoute.get("/me", authMiddleware, (c) => authController.me(c));

export { authRoute };
