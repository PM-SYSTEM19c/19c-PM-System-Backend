import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeAttachmentFile } from "./attachment.storage";

const temporaryDirectories: string[] = [];
async function isolatedStorage() {
	const directory = await fs.mkdtemp(
		path.join(tmpdir(), "pms-upload-storage-"),
	);
	temporaryDirectories.push(directory);
	return path.join(directory, "uploads");
}
afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		// Only fresh directories made by this suite may be recursively removed.
		if (
			path.dirname(directory) !== path.resolve(tmpdir()) ||
			!path.basename(directory).startsWith("pms-upload-storage-")
		)
			throw new Error("Unsafe test cleanup target");
		await fs.rm(directory, { recursive: true, force: true });
	}
});

describe("Runtime attachment storage", () => {
	test("first upload creates the missing directory and preserves binary bytes", async () => {
		const directory = await isolatedStorage();
		const bytes = new Uint8Array([0, 1, 127, 255]);
		await writeAttachmentFile("fixture.png", bytes, directory);
		expect(
			new Uint8Array(await fs.readFile(path.join(directory, "fixture.png"))),
		).toEqual(bytes);
	});
	test("existing storage and files are not removed or overwritten", async () => {
		const directory = await isolatedStorage();
		await writeAttachmentFile(
			"first.txt",
			new TextEncoder().encode("original"),
			directory,
		);
		await writeAttachmentFile(
			"second.txt",
			new TextEncoder().encode("new"),
			directory,
		);
		await expect(
			writeAttachmentFile(
				"first.txt",
				new TextEncoder().encode("replacement"),
				directory,
			),
		).rejects.toMatchObject({ code: "EEXIST" });
		expect(await fs.readFile(path.join(directory, "first.txt"), "utf8")).toBe(
			"original",
		);
	});
	test("concurrent initial uploads safely share one directory", async () => {
		const directory = await isolatedStorage();
		await Promise.all(
			["first.png", "second.png"].map((name) =>
				writeAttachmentFile(name, new Uint8Array([1]), directory),
			),
		);
		expect((await fs.readdir(directory)).sort()).toEqual([
			"first.png",
			"second.png",
		]);
	});
	test("invalid physical names cannot escape storage or create it", async () => {
		const directory = await isolatedStorage();
		for (const name of [
			"",
			".",
			"..",
			"../outside.png",
			"..\\outside.png",
			"C:\\outside.png",
			"file:stream",
			"/outside.png",
		])
			await expect(
				writeAttachmentFile(name, new Uint8Array([1]), directory),
			).rejects.toThrow("Invalid physical attachment filename");
		await expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
	});
	test("storage failures propagate without silently switching directories", async () => {
		const directory = await isolatedStorage();
		await fs.writeFile(directory, "not a directory");
		await expect(
			writeAttachmentFile("fixture.png", new Uint8Array([1]), directory),
		).rejects.toBeDefined();
		expect(await fs.readFile(directory, "utf8")).toBe("not a directory");
	});
});
