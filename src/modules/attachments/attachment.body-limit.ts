import type { MiddlewareHandler } from "hono";
import { MAX_UPLOAD_BYTES } from "./attachment.policy";

// Preserve the 10 MiB file allowance while bounding multipart fields/envelope too.
export const MAX_ATTACHMENT_BODY_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

export function attachmentBodyLimit(
	maxBytes = MAX_ATTACHMENT_BODY_BYTES,
): MiddlewareHandler {
	return async (c, next) => {
		const tooLarge = () =>
			c.json(
				{
					success: false,
					error: {
						code: "PAYLOAD_TOO_LARGE",
						message:
							"Attachment request is too large (max 10 MB file plus multipart overhead)",
					},
				},
				413,
			);
		const declared = c.req.header("content-length");
		if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes)
			return tooLarge();
		const body = c.req.raw.body;
		if (!body) return next();
		const reader = body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > maxBytes) {
					await reader.cancel();
					return tooLarge();
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		// Count actual bytes even when Content-Length was absent or misleading.
		c.req.raw = new Request(c.req.raw, {
			body: new ReadableStream({
				start(controller) {
					for (const chunk of chunks) controller.enqueue(chunk);
					controller.close();
				},
			}),
			duplex: "half",
		} as RequestInit);
		await next();
	};
}
