import { randomUUID } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface JwtPayload {
	sub: string;
	role: string;
	departmentId: string | null;
}

/**
 * In-memory revocation registry for invalidated tokens (e.g., on logout).
 * Stores token -> expiration timestamp (ms) to allow automatic garbage collection.
 */
const revokedTokens = new Map<string, number>();

export function revokeToken(token: string): void {
	try {
		const decoded = jwt.decode(token) as { exp?: number } | null;
		const expiresAt = decoded?.exp
			? decoded.exp * 1000
			: Date.now() + 7 * 24 * 60 * 60 * 1000;
		revokedTokens.set(token, expiresAt);
	} catch {
		revokedTokens.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
	}
}

export function isTokenRevoked(token: string): boolean {
	const expiresAt = revokedTokens.get(token);
	if (!expiresAt) return false;
	if (expiresAt <= Date.now()) {
		revokedTokens.delete(token);
		return false;
	}
	return true;
}

// Periodic cleanup every 10 minutes to prevent memory leaks
const cleanupTimer = setInterval(
	() => {
		const now = Date.now();
		for (const [token, exp] of revokedTokens.entries()) {
			if (exp <= now) {
				revokedTokens.delete(token);
			}
		}
	},
	10 * 60 * 1000,
);
if (cleanupTimer.unref) cleanupTimer.unref();

export function signToken(payload: JwtPayload): string {
	return jwt.sign(payload, env.JWT_SECRET, {
		algorithm: "HS256",
		jwtid: randomUUID(),
		expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
	});
}

export function verifyToken(token: string): JwtPayload {
	return jwt.verify(token, env.JWT_SECRET, {
		algorithms: ["HS256"],
	}) as JwtPayload;
}
