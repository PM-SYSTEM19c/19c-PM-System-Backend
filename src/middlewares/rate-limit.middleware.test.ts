import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { getClientIp, isValidIp, rateLimiter } from "./rate-limit.middleware";

describe("Rate Limit Security Hardening", () => {
	describe("isValidIp", () => {
		it("validates standard IPv4 addresses", () => {
			expect(isValidIp("127.0.0.1")).toBe(true);
			expect(isValidIp("192.168.1.1")).toBe(true);
			expect(isValidIp("203.0.113.195")).toBe(true);
			expect(isValidIp("10.0.0.254")).toBe(true);
		});

		it("validates IPv6 addresses", () => {
			expect(isValidIp("::1")).toBe(true);
			expect(isValidIp("2001:db8::1")).toBe(true);
			expect(isValidIp("fe80::1")).toBe(true);
		});

		it("rejects invalid, malformed, or injected IP strings", () => {
			expect(isValidIp("")).toBe(false);
			expect(isValidIp("   ")).toBe(false);
			expect(isValidIp("abc.def.ghi.jkl")).toBe(false);
			expect(isValidIp("999.999.999.999")).toBe(false);
			expect(isValidIp("1.2.3")).toBe(false);
			expect(isValidIp("1.2.3.4.5")).toBe(false);
			expect(isValidIp("1.2.3.4:8080")).toBe(false);
			expect(isValidIp("<script>alert(1)</script>")).toBe(false);
			expect(isValidIp("192.168.1.1; DROP TABLE users;")).toBe(false);
		});
	});

	describe("getClientIp", () => {
		function createMockContext(headers: Record<string, string>) {
			return {
				req: {
					header: (name: string) => headers[name.toLowerCase()],
				},
			} as any;
		}

		it("ignores spoofed CF-Connecting-IP and X-Real-IP without Cloudflare proxy verification", () => {
			const ctx = createMockContext({
				"cf-connecting-ip": "1.1.1.1",
				"x-real-ip": "2.2.2.2",
			});
			// Must NOT blindly trust cf-connecting-ip or x-real-ip
			expect(getClientIp(ctx)).toBe("unknown-client");
		});

		it("extracts the rightmost valid IP from multi-hop X-Forwarded-For", () => {
			const ctx = createMockContext({
				"x-forwarded-for": "198.51.100.1, 203.0.113.50, 192.0.2.99",
			});
			// Rightmost entry was appended by the immediate trusted proxy (e.g. Railway edge)
			expect(getClientIp(ctx)).toBe("192.0.2.99");
		});

		it("prevents client-injected leftmost spoofing on direct connections", () => {
			const ctx = createMockContext({
				"cf-connecting-ip": "9.9.9.9",
				"x-real-ip": "8.8.8.8",
				"x-forwarded-for": "spoofed-client-ip, 10.0.0.1, 203.0.113.25",
			});
			// Ignores spoofed CF/Real-IP and spoofed leftmost entry; extracts rightmost valid IP
			expect(getClientIp(ctx)).toBe("203.0.113.25");
		});

		it("falls back to unknown-client when headers are empty or missing", () => {
			const ctx = createMockContext({});
			expect(getClientIp(ctx)).toBe("unknown-client");
		});

		it("falls back to unknown-client when all XFF entries are malformed", () => {
			const ctx = createMockContext({
				"x-forwarded-for": "invalid-ip, 999.999.999.999, not-an-ip",
			});
			expect(getClientIp(ctx)).toBe("unknown-client");
		});
	});

	describe("rateLimiter middleware behavior", () => {
		it("allows requests under the limit and returns rate limit headers", async () => {
			const app = new Hono();
			app.use(
				"/test",
				rateLimiter({
					windowMs: 60 * 1000,
					max: 3,
					skipInTest: false,
				}),
			);
			app.get("/test", (c) => c.text("ok"));

			const res1 = await app.request("http://localhost/test", {
				headers: { "x-forwarded-for": "203.0.113.1" },
			});
			expect(res1.status).toBe(200);
			expect(res1.headers.get("X-RateLimit-Limit")).toBe("3");
			expect(res1.headers.get("X-RateLimit-Remaining")).toBe("2");
			expect(res1.headers.get("X-RateLimit-Reset")).toBeDefined();

			const res2 = await app.request("http://localhost/test", {
				headers: { "x-forwarded-for": "203.0.113.1" },
			});
			expect(res2.status).toBe(200);
			expect(res2.headers.get("X-RateLimit-Remaining")).toBe("1");
		});

		it("blocks requests exceeding the limit with 429 and Retry-After", async () => {
			const app = new Hono();
			app.use(
				"/test",
				rateLimiter({
					windowMs: 60 * 1000,
					max: 2,
					message: "Rate limit reached.",
					skipInTest: false,
				}),
			);
			app.get("/test", (c) => c.text("ok"));

			// Request 1: remaining 1
			await app.request("http://localhost/test", {
				headers: { "x-forwarded-for": "203.0.113.2" },
			});
			// Request 2: remaining 0
			await app.request("http://localhost/test", {
				headers: { "x-forwarded-for": "203.0.113.2" },
			});
			// Request 3: blocked (exceeded)
			const res3 = await app.request("http://localhost/test", {
				headers: { "x-forwarded-for": "203.0.113.2" },
			});

			expect(res3.status).toBe(429);
			expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");
			expect(res3.headers.get("Retry-After")).toBeDefined();

			const body = await res3.json();
			expect(body).toEqual({
				success: false,
				error: {
					code: "RATE_LIMITED",
					message: "Rate limit reached.",
				},
			});
		});

		it("maintains isolated buckets for different client IPs", async () => {
			const app = new Hono();
			app.use(
				"/test",
				rateLimiter({
					windowMs: 60 * 1000,
					max: 1,
					skipInTest: false,
				}),
			);
			app.get("/test", (c) => c.text("ok"));

			// Client A exhausts quota
			const resA1 = await app.request("http://localhost/test", {
				headers: { "x-forwarded-for": "203.0.113.10" },
			});
			expect(resA1.status).toBe(200);

			const resA2 = await app.request("http://localhost/test", {
				headers: { "x-forwarded-for": "203.0.113.10" },
			});
			expect(resA2.status).toBe(429);

			// Client B is not affected by Client A
			const resB1 = await app.request("http://localhost/test", {
				headers: { "x-forwarded-for": "203.0.113.20" },
			});
			expect(resB1.status).toBe(200);
		});

		it("isolates authenticated users by user ID to prevent shared proxy quota collisions", async () => {
			const app = new Hono();
			// Mock auth middleware setting user on context
			app.use("/test", async (c, next) => {
				const userId = c.req.header("x-mock-user-id");
				if (userId) {
					c.set("user", {
						id: userId,
						role: "INTERNAL",
						departmentId: "dept-1",
					} as any);
				}
				await next();
			});
			app.use(
				"/test",
				rateLimiter({
					windowMs: 60 * 1000,
					max: 1,
					skipInTest: false,
				}),
			);
			app.get("/test", (c) => c.text("ok"));

			// User 1 behind shared proxy IP (e.g. Vercel)
			const res1 = await app.request("http://localhost/test", {
				headers: {
					"x-forwarded-for": "76.76.21.21",
					"x-mock-user-id": "user-1",
				},
			});
			expect(res1.status).toBe(200);

			// User 1 exhausted
			const res1Again = await app.request("http://localhost/test", {
				headers: {
					"x-forwarded-for": "76.76.21.21",
					"x-mock-user-id": "user-1",
				},
			});
			expect(res1Again.status).toBe(429);

			// User 2 behind THE SAME shared proxy IP is NOT locked out
			const res2 = await app.request("http://localhost/test", {
				headers: {
					"x-forwarded-for": "76.76.21.21",
					"x-mock-user-id": "user-2",
				},
			});
			expect(res2.status).toBe(200);
		});
	});
});
