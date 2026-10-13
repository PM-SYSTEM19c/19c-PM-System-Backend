import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { User } from "@prisma/client";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, ForbiddenError, ValidationError } from "../shared/errors";
import { internalOnly } from "./role.middleware";

// No database connection is used; deterministic defaults also let this suite run in CI.
process.env.DATABASE_URL ??= "postgresql://audit-test@127.0.0.1:1/audit_test";
process.env.JWT_SECRET ??= "unit-test-only-secret-not-for-production-use";
const { revokeToken, signToken } = await import("../lib/jwt");
const { createAuthMiddleware } = await import("./auth.middleware");
const { env } = await import("../config/env");

const user = {
	id: "auth-test-user",
	role: "INTERNAL",
	departmentId: "test-department",
	status: "APPROVED",
} as const;

function createApp(routeError?: Error) {
	const app = new Hono();
	app.onError((error, c) =>
		c.json(
			{ code: error instanceof AppError ? error.code : "INTERNAL_ERROR" },
			(error instanceof AppError
				? error.statusCode
				: 500) as ContentfulStatusCode,
		),
	);
	app.use("*", createAuthMiddleware(findUser));
	app.get("/protected", (c) => {
		if (routeError) throw routeError;
		return c.json(c.get("user"));
	});
	app.all("/api/v1/tasks/task-one/attachments", internalOnly(), (c) =>
		c.json(c.get("user")),
	);
	app.get("/api/v1/uploads/file.png", internalOnly(), (c) =>
		c.json(c.get("user")),
	);
	return app;
}

function token(id: string = user.id) {
	return signToken({
		sub: id,
		role: user.role,
		departmentId: user.departmentId,
	});
}

const findUser = mock(
	async (
		_id: string,
	): Promise<Pick<User, "id" | "role" | "departmentId" | "status"> | null> =>
		user,
);
afterEach(() => findUser.mockReset());

describe("Authentication boundary", () => {
	test("cookie transport still blocks CLIENT from internal attachments", async () => {
		findUser.mockResolvedValue({ ...user, role: "CLIENT" });
		const name =
			env.NODE_ENV === "production" ? "__Host-pms-session" : "pms-session";
		expect(
			(
				await createApp().request("/api/v1/uploads/file.png", {
					headers: { Cookie: `${name}=${token()}` },
				})
			).status,
		).toBe(403);
	});
	test("cookie transport rejects revoked tokens and unapproved accounts", async () => {
		const name =
			env.NODE_ENV === "production" ? "__Host-pms-session" : "pms-session";
		const revoked = token("revoked-attachment-cookie-test");
		revokeToken(revoked);
		expect(
			(
				await createApp().request("/api/v1/uploads/file.png", {
					headers: { Cookie: `${name}=${revoked}` },
				})
			).status,
		).toBe(401);
		for (const status of ["PENDING", "REJECTED"] as const) {
			findUser.mockResolvedValue({ ...user, status });
			expect(
				(
					await createApp().request("/api/v1/uploads/file.png", {
						headers: { Cookie: `${name}=${token()}` },
					})
				).status,
			).toBe(401);
		}
	});
	test("attachment cookie reads use current database identity", async () => {
		findUser.mockResolvedValue(user);
		const cookieName =
			env.NODE_ENV === "production" ? "__Host-pms-session" : "pms-session";
		const response = await createApp().request("/api/v1/uploads/file.png", {
			headers: { Cookie: `${cookieName}=${token()}` },
		});
		expect(response.status).toBe(200);
		expect((await response.json()) as unknown).toEqual({
			id: user.id,
			role: user.role,
			departmentId: user.departmentId,
		});
	});
	test("cookie credentials are not accepted on unrelated API routes", async () => {
		const response = await createApp().request("/protected", {
			headers: { Cookie: `pms-session=${token()}` },
		});
		expect(response.status).toBe(401);
		expect(findUser).not.toHaveBeenCalled();
	});
	test("attachment writes require trusted Origin and session-bound CSRF", async () => {
		const sessionToken = token();
		const cookieName =
			env.NODE_ENV === "production" ? "__Host-pms-session" : "pms-session";
		const origin = env.CORS_ORIGIN.split(",")[0]!.trim();
		const protection = createHmac("sha256", sessionToken)
			.update("pms-csrf-v1")
			.digest("hex");
		for (const headers of [
			{},
			{ Origin: "https://attacker.example", "X-CSRF-Token": protection },
			{ Origin: origin },
			{ Origin: origin, "X-CSRF-Token": "0".repeat(64) },
		] as Record<string, string>[]) {
			const response = await createApp().request(
				"/api/v1/tasks/task-one/attachments",
				{
					method: "POST",
					headers: { Cookie: `${cookieName}=${sessionToken}`, ...headers },
				},
			);
			expect(response.status).toBe(403);
		}
		findUser.mockResolvedValue(user);
		const response = await createApp().request(
			"/api/v1/tasks/task-one/attachments",
			{
				method: "POST",
				headers: {
					Cookie: `${cookieName}=${sessionToken}`,
					Origin: origin,
					"X-CSRF-Token": protection,
				},
			},
		);
		expect(response.status).toBe(200);
	});
	test("cross-site metadata and duplicate cookies are rejected", async () => {
		const cookieName =
			env.NODE_ENV === "production" ? "__Host-pms-session" : "pms-session";
		const cookie = `${cookieName}=${token()}`;
		expect(
			(
				await createApp().request("/api/v1/uploads/file.png", {
					headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
				})
			).status,
		).toBe(403);
		expect(
			(
				await createApp().request("/api/v1/uploads/file.png", {
					headers: { Cookie: `${cookie}; ${cookie}` },
				})
			).status,
		).toBe(401);
	});
	test("invalid cookie JWT is rejected and explicit bad Authorization never falls back to cookies", async () => {
		const cookieName =
			env.NODE_ENV === "production" ? "__Host-pms-session" : "pms-session";
		expect(
			(
				await createApp().request("/api/v1/uploads/file.png", {
					headers: { Cookie: `${cookieName}=header.payload.signature` },
				})
			).status,
		).toBe(401);
		expect(
			(
				await createApp().request("/api/v1/uploads/file.png", {
					headers: {
						Cookie: `${cookieName}=${token()}`,
						Authorization: "invalid",
					},
				})
			).status,
		).toBe(401);
	});
	test("rejects missing credentials without querying the database", async () => {
		const response = await createApp().request("/protected");
		expect(response.status).toBe(401);
		expect(findUser).not.toHaveBeenCalled();
	});

	test("rejects invalid tokens without querying the database", async () => {
		const response = await createApp().request("/protected", {
			headers: { Authorization: "Bearer invalid-token" },
		});
		expect(response.status).toBe(401);
		expect(findUser).not.toHaveBeenCalled();
	});

	test("rejects revoked tokens", async () => {
		const revoked = token("revoked-auth-test-user");
		revokeToken(revoked);
		const response = await createApp().request("/protected", {
			headers: { Authorization: `Bearer ${revoked}` },
		});
		expect(response.status).toBe(401);
		expect(findUser).not.toHaveBeenCalled();
	});

	test("uses current database permissions rather than stale token claims", async () => {
		findUser.mockResolvedValue(user);
		const staleClaims = signToken({
			sub: user.id,
			role: "PM",
			departmentId: "old-department",
		});
		const response = await createApp().request("/protected", {
			headers: { Authorization: `Bearer ${staleClaims}` },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: user.id,
			role: user.role,
			departmentId: user.departmentId,
		});
		expect(findUser).toHaveBeenCalledWith(user.id);
	});

	for (const status of ["PENDING", "REJECTED"] as const) {
		test(`rejects ${status} users`, async () => {
			findUser.mockResolvedValue({ ...user, status });
			const response = await createApp().request("/protected", {
				headers: { Authorization: `Bearer ${token()}` },
			});
			expect(response.status).toBe(401);
		});
	}

	test("rejects missing or deleted users", async () => {
		findUser.mockResolvedValue(null);
		const response = await createApp().request("/protected", {
			headers: { Authorization: `Bearer ${token()}` },
		});
		expect(response.status).toBe(401);
	});

	test("does not misclassify a database outage as invalid credentials", async () => {
		findUser.mockRejectedValue(new Error("Simulated database outage"));
		const response = await createApp().request("/protected", {
			headers: { Authorization: `Bearer ${token()}` },
		});
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ code: "INTERNAL_ERROR" });
	});

	for (const error of [
		new ForbiddenError(),
		new ValidationError("Invalid input"),
	]) {
		test(`preserves downstream ${error.statusCode} errors`, async () => {
			findUser.mockResolvedValue(user);
			const response = await createApp(error).request("/protected", {
				headers: { Authorization: `Bearer ${token()}` },
			});
			expect(response.status).toBe(error.statusCode);
		});
	}
});
