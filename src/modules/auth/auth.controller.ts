import type { Context } from "hono";
import { authService } from "./auth.service";
import { registerSchema, loginSchema } from "./auth.schema";
import { successResponse } from "../../shared/response";
import { ValidationError } from "../../shared/errors";
import type { AuthUser } from "../../shared/types";

export class AuthController {
  async register(c: Context) {
    const body = await c.req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const result = await authService.register(parsed.data);
    return successResponse(c, result, 201);
  }

  async login(c: Context) {
    const body = await c.req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const result = await authService.login(parsed.data);
    return successResponse(c, result);
  }

  async logout(c: Context) {
    // For JWT-based auth, logout is handled client-side by removing the token
    // Server-side token invalidation could use a blacklist (Redis), but for
    // this assessment we keep it simple
    return successResponse(c, { message: "Logged out successfully" });
  }

  async me(c: Context) {
    const user = c.get("user") as AuthUser;
    const result = await authService.getMe(user.id);
    return successResponse(c, result);
  }
}

export const authController = new AuthController();
