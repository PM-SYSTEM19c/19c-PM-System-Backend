import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??=
	"postgresql://session-test@127.0.0.1:1/session_test";
process.env.JWT_SECRET ??= "unit-test-only-secret-not-for-production-use";
const { signToken, verifyToken, revokeToken, isTokenRevoked } = await import(
	"./jwt"
);

describe("Session token isolation", () => {
	test("each login gets a unique token even within the same second", () => {
		const identity = {
			sub: "unique-session-test",
			role: "PM",
			departmentId: null,
		};
		const first = signToken(identity);
		const second = signToken(identity);
		expect(first).not.toBe(second);
		expect(verifyToken(first).sub).toBe(identity.sub);
		revokeToken(first);
		expect(isTokenRevoked(first)).toBe(true);
		expect(isTokenRevoked(second)).toBe(false);
	});
});
