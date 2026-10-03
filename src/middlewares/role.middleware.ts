import type { Context, Next } from "hono";
import type { Role } from "@prisma/client";
import { ForbiddenError } from "../shared/errors";
import type { AuthUser } from "../shared/types";

/**
 * Role middleware factory — Layer 2 of Access Control
 * Checks if authenticated user has one of the allowed roles
 */
export function requireRole(...allowedRoles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as AuthUser;

    if (!user) {
      throw new ForbiddenError("Authentication required");
    }

    if (!allowedRoles.includes(user.role as Role)) {
      throw new ForbiddenError(
        `This action requires one of the following roles: ${allowedRoles.join(", ")}`
      );
    }

    await next();
  };
}

/**
 * Shorthand for PM-only routes
 */
export function pmOnly() {
  return requireRole("PM" as Role);
}

/**
 * Shorthand for internal team routes (PM can also access)
 */
export function internalOnly() {
  return requireRole("PM" as Role, "INTERNAL" as Role);
}
