import { createHmac, timingSafeEqual } from "node:crypto";

/** Cookie transport is deliberately limited to externally rewritten attachment routes. */
export function isAttachmentSessionPath(path: string): boolean {
	return /^\/api\/v1\/(?:uploads\/[^/]+|tasks\/[^/]+\/attachments(?:\/[^/]+)?)$/.test(
		path,
	);
}

export function attachmentSessionToken(
	cookieHeader: string | undefined,
	secure: boolean,
): string | undefined {
	const name = secure ? "__Host-pms-session" : "pms-session";
	const values = (cookieHeader ?? "")
		.split(";")
		.map((part) => part.trim())
		.filter((part) => part.startsWith(`${name}=`));
	if (values.length !== 1 || !values[0]) return undefined;
	try {
		const value = decodeURIComponent(values[0].slice(name.length + 1));
		return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

/** Same session-bound HMAC contract as the Next browser session boundary. */
export function validAttachmentCsrf(
	token: string,
	supplied: string | undefined,
): boolean {
	if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
	const expected = createHmac("sha256", token)
		.update("pms-csrf-v1")
		.digest("hex");
	return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function allowedAttachmentOrigin(
	origin: string | undefined,
	allowedOrigins: string,
): boolean {
	return (
		!!origin &&
		origin !== "null" &&
		allowedOrigins
			.split(",")
			.map((entry) => entry.trim())
			.includes(origin)
	);
}
