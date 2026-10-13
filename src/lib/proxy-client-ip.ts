import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

interface ProxyIpRequest {
	method: string;
	path: string;
	header: (name: string) => string | undefined;
}

/** Trust only short-lived metadata signed by our Next server, never a plain IP header. */
export function verifiedProxyClientIp(
	request: ProxyIpRequest,
	secret: string | undefined,
	now = Date.now(),
): string | undefined {
	if (!secret || secret.length < 32) return undefined;
	const ip = request.header("x-pms-client-ip");
	const timestamp = request.header("x-pms-proxy-time");
	const signature = request.header("x-pms-proxy-signature");
	if (
		!ip ||
		!isIP(ip) ||
		!timestamp ||
		!/^\d{10}$/.test(timestamp) ||
		!signature ||
		!/^[a-f0-9]{64}$/.test(signature)
	)
		return undefined;
	if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 30)
		return undefined;
	const expected = createHmac("sha256", secret)
		.update(
			`${timestamp}\n${ip}\n${request.method.toUpperCase()}\n${request.path}`,
		)
		.digest("hex");
	return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
		? ip
		: undefined;
}
