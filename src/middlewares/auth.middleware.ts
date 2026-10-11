import type { Context, Next } from "hono";
import { isTokenRevoked, verifyToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import { UnauthorizedError } from "../shared/errors";
import type { AuthUser } from "../shared/types";

/**
 * Authentication middleware — Layer 1 of Access Control
 * Verifies JWT token and attaches user context to request
 */
export async function authMiddleware(c: Context, next: Next) {
	const authHeader = c.req.header("Authorization");

	if (!authHeader?.startsWith("Bearer ")) {
		throw new UnauthorizedError("Missing or invalid authorization header");
	}

	const token = authHeader.substring(7);

	// Check if token was invalidated via logout (SEC-AUD-002)
	if (isTokenRevoked(token)) {
		throw new UnauthorizedError("Token has been revoked");
	}

	try {
		const payload = verifyToken(token);

		// Verify user exists, is not soft-deleted, and has ACTIVE status (SEC-AUD-001)
		const user = await prisma.user.findFirst({
			where: {
				id: payload.sub,
				deletedAt: null,
			},
			select: {
				id: true,
				role: true,
				departmentId: true,
				status: true,
			},
		});

		if (!user) {
			throw new UnauthorizedError("User not found or has been deactivated");
		}

		if (user.status !== "APPROVED") {
			throw new UnauthorizedError(
				user.status === "PENDING"
					? "Your account is pending PM approval"
					: "Your account has been deactivated or rejected",
			);
		}

		// Attach user to context
		const authUser: AuthUser = {
			id: user.id,
			role: user.role,
			departmentId: user.departmentId,
		};

		c.set("user", authUser);
		await next();
	} catch (error) {
		if (error instanceof UnauthorizedError) throw error;
		throw new UnauthorizedError("Invalid or expired token");
	}
}
