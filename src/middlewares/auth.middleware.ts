import type { User } from "@prisma/client";
import type { Context, Next } from "hono";
import { env } from "../config/env";
import {
	allowedAttachmentOrigin,
	attachmentSessionToken,
	isAttachmentSessionPath,
	validAttachmentCsrf,
} from "../lib/browser-attachment-session";
import { isTokenRevoked, verifyToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import { AppError, UnauthorizedError } from "../shared/errors";
import type { AuthUser } from "../shared/types";

/**
 * Authentication middleware — Layer 1 of Access Control
 * Verifies JWT token and attaches user context to request
 */
type AuthRecord = Pick<User, "id" | "role" | "departmentId" | "status">;
type LookupAuthUser = (id: string) => Promise<AuthRecord | null>;

/** Injectable database boundary keeps authentication tests independent of live data. */
export function createAuthMiddleware(
	lookupUser: LookupAuthUser = (id) =>
		prisma.user.findFirst({
			where: { id, deletedAt: null },
			select: { id: true, role: true, departmentId: true, status: true },
		}),
) {
	return async (c: Context, next: Next) => {
		const authHeader = c.req.header("Authorization");

		const cookieTransport = !authHeader && isAttachmentSessionPath(c.req.path);
		const token = authHeader?.startsWith("Bearer ")
			? authHeader.substring(7)
			: cookieTransport
				? attachmentSessionToken(
						c.req.header("cookie"),
						env.NODE_ENV === "production",
					)
				: undefined;
		if (!token) {
			throw new UnauthorizedError("Missing or invalid authorization header");
		}

		if (cookieTransport) {
			const origin = c.req.header("origin");
			const unsafe = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
			if (
				c.req.header("sec-fetch-site") === "cross-site" ||
				(origin && !allowedAttachmentOrigin(origin, env.CORS_ORIGIN)) ||
				(unsafe &&
					(!allowedAttachmentOrigin(origin, env.CORS_ORIGIN) ||
						!validAttachmentCsrf(token, c.req.header("x-csrf-token"))))
			) {
				throw new AppError(
					"CSRF_INVALID",
					403,
					"Missing or invalid attachment request protection",
				);
			}
		}

		// Check if token was invalidated via logout (SEC-AUD-002)
		if (isTokenRevoked(token)) {
			throw new UnauthorizedError("Token has been revoked");
		}

		let payload: ReturnType<typeof verifyToken>;
		try {
			payload = verifyToken(token);
		} catch {
			throw new UnauthorizedError("Invalid or expired token");
		}

		// Verify the user exists, is not soft-deleted, and is APPROVED.
		const user = await lookupUser(payload.sub);

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
	};
}

export const authMiddleware = createAuthMiddleware();
