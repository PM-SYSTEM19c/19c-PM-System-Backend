import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { authRateLimiter } from "../../middlewares/rate-limit.middleware";
import { authController } from "./auth.controller";

const authRoute = new Hono();

// Public routes (rate limited to protect against brute force and credential stuffing)
authRoute.post("/register", authRateLimiter, (c) => authController.register(c));
authRoute.post("/login", authRateLimiter, (c) => authController.login(c));

// Protected routes
authRoute.post("/logout", authMiddleware, (c) => authController.logout(c));
authRoute.get("/me", authMiddleware, (c) => authController.me(c));

export { authRoute };
