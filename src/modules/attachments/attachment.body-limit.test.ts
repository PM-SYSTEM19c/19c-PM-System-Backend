import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
	attachmentBodyLimit,
	MAX_ATTACHMENT_BODY_BYTES,
} from "./attachment.body-limit";
import { MAX_UPLOAD_BYTES } from "./attachment.policy";

describe("Attachment request body boundary", () => {
	function app(maxBytes?: number) {
		const app = new Hono();
		app.post("/upload", attachmentBodyLimit(maxBytes), async (c) =>
			c.json({ bytes: (await c.req.arrayBuffer()).byteLength }),
		);
		return app;
	}
	test("keeps 10 MiB file capacity plus multipart overhead", async () => {
		expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
		expect(MAX_ATTACHMENT_BODY_BYTES).toBeGreaterThan(MAX_UPLOAD_BYTES);
		const response = await app().request("/upload", {
			method: "POST",
			body: new Uint8Array(MAX_UPLOAD_BYTES + 512),
		});
		expect(response.status).toBe(200);
		expect(((await response.json()) as { bytes: number }).bytes).toBe(
			MAX_UPLOAD_BYTES + 512,
		);
	});
	test("rejects declared oversized bodies before reading", async () => {
		const response = await app(32).request("/upload", {
			method: "POST",
			headers: { "Content-Length": "999" },
			body: "small",
		});
		expect(response.status).toBe(413);
	});
	test("counts real bytes even if declared length is too small", async () => {
		const response = await app(32).request("/upload", {
			method: "POST",
			headers: { "Content-Length": "1" },
			body: new Uint8Array(33),
		});
		expect(response.status).toBe(413);
	});
	test("rejects unknown-length streamed bodies beyond the limit", async () => {
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(20));
				controller.enqueue(new Uint8Array(20));
				controller.close();
			},
		});
		const response = await app(32).request(
			new Request("http://localhost/upload", {
				method: "POST",
				body,
				duplex: "half",
			} as RequestInit),
		);
		expect(response.status).toBe(413);
	});
	test("preserves multipart parsing and filename/type", async () => {
		const form = new FormData();
		form.set(
			"file",
			new File(["fixture"], "fixture.png", { type: "image/png" }),
		);
		const app = new Hono();
		app.post("/upload", attachmentBodyLimit(), async (c) => {
			const data = await c.req.parseBody();
			const file = data.file as File;
			return c.json({
				name: file.name,
				type: file.type,
				text: await file.text(),
			});
		});
		const response = await app.request("/upload", {
			method: "POST",
			body: form,
		});
		expect(await response.json()).toEqual({
			name: "fixture.png",
			type: "image/png",
			text: "fixture",
		});
	});
});
