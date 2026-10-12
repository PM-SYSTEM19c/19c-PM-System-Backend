import { isIP } from "node:net";
import type { Context, Next } from "hono";

export interface RateLimitOptions {
	windowMs: number;
	max: number;
	message?: string;
	skipInTest?: boolean;
	keyGenerator?: (c: Context) => string;
}

/**
 * Validates whether a string is a syntactically valid IPv4 or IPv6 address.
 * Rejects hostnames, malformed strings, ports, and header injection attempts.
 */
export function isValidIp(ip: string): boolean {
	if (!ip || typeof ip !== "string") return false;
	return isIP(ip.trim()) !== 0;
}

/**
 * Client IP resolution for single-proxy architecture (Railway edge).
 *
 * Security Rationale (SEC-P2-RATE-LIMIT):
 * 1. Does NOT trust client-supplied CF-Connecting-IP or X-Real-IP because
 *    Railway's default edge proxy does not authenticate Cloudflare origins or strip
 *    untrusted client headers. Blindly trusting them allows arbitrary rate limit bypass.
 * 2. Parses X-Forwarded-For strictly, validating each IP token to prevent injection.
 * 3. In direct Railway deployments, Railway's edge appends the client's TCP remote address
 *    as the rightmost entry in X-Forwarded-For. Taking the rightmost valid IP prevents
 *    client-injected leftmost spoofing.
 * 4. Architectural Note on Multi-Hop (Vercel -> Railway):
 *    In multi-hop proxy chains (e.g., Next.js rewrites on Vercel), the rightmost IP
 *    is Vercel's edge proxy IP. Without mutual proxy authentication (e.g., a shared
 *    secret header between Vercel and Railway), the application cannot cryptographically
 *    distinguish an upstream proxy from an external attacker. For authenticated routes,
 *    keying by authenticated user ID eliminates false-positive proxy collisions.
 */
export function getClientIp(c: Context): string {
	const xff = c.req.header("x-forwarded-for");
	if (xff) {
		const validIps = xff
			.split(",")
			.map((ip) => ip.trim())
			.filter(isValidIp);

		if (validIps.length > 0) {
			const rightmostIp = validIps[validIps.length - 1];
			if (rightmostIp) return rightmostIp;
		}
	}

	return "unknown-client";
}

/**
 * In-memory sliding-window rate limiter for sensitive endpoints.
 * Uses key-based tracking (User ID when authenticated, else Client IP) with automatic cleanup.
 */
export function rateLimiter(options: RateLimitOptions) {
	const {
		windowMs,
		max,
		message = "Too many requests, please try again later.",
		skipInTest = true,
		keyGenerator = (c: Context) => {
			const user = c.get("user") as { id?: string } | undefined;
			if (user?.id) {
				return `user:${user.id}`;
			}
			return getClientIp(c);
		},
	} = options;

	const hits = new Map<string, { count: number; resetTime: number }>();

	// Cleanup stale entries every 60 seconds
	const timer = setInterval(() => {
		const now = Date.now();
		for (const [key, record] of hits.entries()) {
			if (record.resetTime <= now) {
				hits.delete(key);
			}
		}
	}, 60000);
	if (timer.unref) timer.unref();

	return async (c: Context, next: Next) => {
		// In test mode, allow high throughput so automated E2E suites don't fail unless explicitly opted-in
		if (skipInTest && process.env.NODE_ENV === "test") {
			return next();
		}

		const key = keyGenerator(c);
		const now = Date.now();
		let record = hits.get(key);

		if (!record || record.resetTime <= now) {
			record = { count: 1, resetTime: now + windowMs };
			hits.set(key, record);
		} else {
			record.count++;
		}

		c.header("X-RateLimit-Limit", max.toString());
		c.header(
			"X-RateLimit-Remaining",
			Math.max(0, max - record.count).toString(),
		);
		c.header(
			"X-RateLimit-Reset",
			Math.ceil(record.resetTime / 1000).toString(),
		);

		if (record.count > max) {
			c.header(
				"Retry-After",
				Math.ceil((record.resetTime - now) / 1000).toString(),
			);
			return c.json(
				{
					success: false,
					error: {
						code: "RATE_LIMITED",
						message,
					},
				},
				429,
			);
		}

		await next();
	};
}

/**
 * Standard auth rate limiter: 60 attempts per minute per IP (SEC-AUD-003)
 */
export const authRateLimiter = rateLimiter({
	windowMs: 60 * 1000,
	max: 60,
	message: "Too many authentication attempts. Please try again in a minute.",
	keyGenerator: (c) => getClientIp(c),
});

/**
 * Rate limiter for file uploads: 30 uploads per minute per user/IP (SEC-AUD-005)
 */
export const uploadRateLimiter = rateLimiter({
	windowMs: 60 * 1000,
	max: 30,
	message: "Too many file upload requests. Please wait a moment.",
});

/**
 * Rate limiter for file downloads: 60 downloads per minute per user/IP
 */
export const downloadRateLimiter = rateLimiter({
	windowMs: 60 * 1000,
	max: 60,
	message: "Too many file download requests. Please wait a moment.",
});

/**
 * Rate limiter for heavy batch operations (e.g. batch standup generation): 10 requests per minute (SEC-AUD-005)
 */
export const batchStandupRateLimiter = rateLimiter({
	windowMs: 60 * 1000,
	max: 10,
	message: "Too many batch generation requests. Please try again in a minute.",
});

/**
 * Rate limiter for single-project standup generation: 15 requests per minute
 */
export const standupGenerateRateLimiter = rateLimiter({
	windowMs: 60 * 1000,
	max: 15,
	message: "Too many standup generation requests. Please wait a moment.",
});
