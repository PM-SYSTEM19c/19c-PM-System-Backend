import { describe, expect, test } from "bun:test";
import {
	ALLOWED_MIME_TYPES,
	safeAttachmentMimeType,
} from "./attachment.policy";

describe("Physical attachment response policy", () => {
	test("retains the existing supported upload MIME types", () => {
		for (const mimeType of ALLOWED_MIME_TYPES)
			expect(safeAttachmentMimeType(mimeType)).toBe(mimeType);
	});
	test("does not serve active or header-injected MIME metadata inline", () => {
		for (const mimeType of [
			"text/html",
			"image/svg+xml",
			"application/javascript",
			"image/png\r\nX-Test: injected",
		]) {
			expect(safeAttachmentMimeType(mimeType)).toBe("application/octet-stream");
		}
	});
	test("uses a safe fallback for absent or unrecognized metadata", () => {
		expect(safeAttachmentMimeType(null)).toBe("application/octet-stream");
		expect(safeAttachmentMimeType("unknown/type")).toBe(
			"application/octet-stream",
		);
	});
});
