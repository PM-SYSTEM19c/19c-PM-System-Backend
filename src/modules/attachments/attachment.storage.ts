import fs from "node:fs/promises";
import path from "node:path";

/** Create runtime storage only for a validated upload; never overwrite existing files. */
export async function writeAttachmentFile(
	fileName: string,
	contents: Uint8Array,
	uploadDirectory = path.resolve(process.cwd(), "uploads"),
): Promise<void> {
	if (
		!/^[a-zA-Z0-9._-]+$/.test(fileName) ||
		fileName === "." ||
		fileName === ".."
	)
		throw new Error("Invalid physical attachment filename");
	await fs.mkdir(uploadDirectory, { recursive: true });
	await fs.writeFile(path.join(uploadDirectory, fileName), contents, {
		flag: "wx",
	});
}
