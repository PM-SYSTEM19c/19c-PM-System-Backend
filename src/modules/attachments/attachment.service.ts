import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../shared/errors";
import type { AuthUser } from "../../shared/types";
import { projectService } from "../projects/project.service";
import { safeAttachmentMimeType } from "./attachment.policy";

export interface PhysicalAttachmentResult {
	buffer: Buffer;
	fileName: string;
	mimeType: string;
}

export class AttachmentService {
	/**
	 * Securely resolves, authorizes, and reads a physical attachment file from disk.
	 * Guards against path traversal and verifies project authorization.
	 */
	async getPhysicalAttachment(
		rawFileName: string | undefined,
		user: AuthUser,
	): Promise<PhysicalAttachmentResult> {
		if (!rawFileName) {
			throw new NotFoundError("Attachment", "unknown");
		}

		// 1. Prevent path traversal attacks
		const fileName = path.basename(rawFileName);
		if (!fileName || fileName !== rawFileName) {
			throw new NotFoundError("Attachment", rawFileName);
		}

		// 2. Lookup task attachment in database
		const attachment = await prisma.taskAttachment.findFirst({
			where: {
				fileUrl: { endsWith: `/${fileName}` },
				deletedAt: null,
			},
			include: {
				task: {
					select: {
						id: true,
						projectId: true,
						deletedAt: true,
					},
				},
			},
		});

		if (!attachment || attachment.task.deletedAt !== null) {
			throw new NotFoundError("Attachment", fileName);
		}

		// 3. Check project access using existing projectService.checkProjectAccess
		await projectService.checkProjectAccess(attachment.task.projectId, user);

		// 4. Verify physical file on disk
		const filePath = path.resolve(process.cwd(), "uploads", fileName);
		try {
			const stat = await fs.stat(filePath);
			if (!stat.isFile()) {
				throw new NotFoundError("File", fileName);
			}
		} catch {
			throw new NotFoundError("File", fileName);
		}

		// 5. Read physical file content
		const buffer = await fs.readFile(filePath);
		const mimeType = safeAttachmentMimeType(attachment.mimeType);
		const displayName = attachment.fileName || fileName;

		return {
			buffer,
			fileName: displayName,
			mimeType,
		};
	}
}

export const attachmentService = new AttachmentService();
