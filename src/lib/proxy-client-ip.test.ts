import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { getClientIp, rateLimiter } from "../middlewares/rate-limit.middleware";
import { verifiedProxyClientIp } from "./proxy-client-ip";

const secret = "proxy-ip-test-only-secret-not-for-production";
const now = 1800000000000;
function signed(
	ip = "203.0.113.1",
	method = "POST",
	path = "/api/v1/auth/login",
	timestamp = Math.floor(now / 1000).toString(),
) {
	return {
		"x-pms-client-ip": ip,
		"x-pms-proxy-time": timestamp,
		"x-pms-proxy-signature": createHmac("sha256", secret)
			.update(`${timestamp}\n${ip}\n${method}\n${path}`)
			.digest("hex"),
	};
}
function read(
	headers: Record<string, string>,
	method = "POST",
	path = "/api/v1/auth/login",
	key: string | undefined = secret,
) {
	return verifiedProxyClientIp(
		{ method, path, header: (name) => headers[name] },
		key,
		now,
	);
}

describe("Signed proxy IP boundary", () => {
	test("valid IPv4/IPv6 signatures recover visitor IP", () => {
		for (const ip of ["203.0.113.1", "2001:db8::1"])
			expect(read(signed(ip))).toBe(ip);
	});
	test("unsigned, altered, malformed, or wrong-key metadata is not trusted", () => {
		expect(read({ "x-pms-client-ip": "203.0.113.1" })).toBeUndefined();
		expect(
			read({ ...signed(), "x-pms-client-ip": "203.0.113.2" }),
		).toBeUndefined();
		expect(
			read({ ...signed(), "x-pms-proxy-signature": "wrong" }),
		).toBeUndefined();
		expect(read(signed("203.0.113.1, 198.51.100.1"))).toBeUndefined();
		expect(
			read(signed(), "POST", "/api/v1/auth/login", "wrong-key".repeat(5)),
		).toBeUndefined();
		expect(
			read(signed(), "POST", "/api/v1/auth/login", "short"),
		).toBeUndefined();
	});
	test("signature is bound to path/method and expires after 30 seconds", () => {
		expect(read(signed(), "GET")).toBeUndefined();
		expect(read(signed(), "POST", "/api/v1/auth/register")).toBeUndefined();
		for (const offset of [-31, 31])
			expect(
				read(
					signed(
						"203.0.113.1",
						"POST",
						"/api/v1/auth/login",
						(Math.floor(now / 1000) + offset).toString(),
					),
				),
			).toBeUndefined();
	});
	test("forged metadata falls back to the existing edge IP, never the claimed visitor", () => {
		const previous = process.env.API_PROXY_SECRET;
		process.env.API_PROXY_SECRET = secret;
		try {
			const headers = {
				...signed(),
				"x-pms-proxy-signature": "0".repeat(64),
				"x-forwarded-for": "192.0.2.99",
			};
			expect(
				getClientIp({
					req: {
						method: "POST",
						path: "/api/v1/auth/login",
						header: (name: string) => headers[name as keyof typeof headers],
					},
				} as any),
			).toBe("192.0.2.99");
		} finally {
			if (previous === undefined) delete process.env.API_PROXY_SECRET;
			else process.env.API_PROXY_SECRET = previous;
		}
	});
	test("two signed visitors behind the same proxy receive independent auth quotas", async () => {
		const previous = process.env.API_PROXY_SECRET;
		process.env.API_PROXY_SECRET = secret;
		try {
			const app = new Hono();
			app.post(
				"/api/v1/auth/login",
				rateLimiter({ max: 1, windowMs: 60000, skipInTest: false }),
				(c) => c.text("ok"),
			);
			const timestamp = Math.floor(Date.now() / 1000).toString();
			const request = (ip: string) =>
				app.request("/api/v1/auth/login", {
					method: "POST",
					headers: {
						...signed(ip, "POST", "/api/v1/auth/login", timestamp),
						"x-forwarded-for": "192.0.2.99",
					},
				});
			expect((await request("203.0.113.1")).status).toBe(200);
			expect((await request("203.0.113.1")).status).toBe(429);
			expect((await request("203.0.113.2")).status).toBe(200);
		} finally {
			if (previous === undefined) delete process.env.API_PROXY_SECRET;
			else process.env.API_PROXY_SECRET = previous;
		}
	});
});
