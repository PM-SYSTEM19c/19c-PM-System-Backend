import fs from "node:fs/promises";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { internalOnly } from "../../middlewares/role.middleware";
import {
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../../shared/errors";
import { successResponse } from "../../shared/response";
import type { AuthUser } from "../../shared/types";
import { getParam } from "../../shared/utils/params";
import { projectService } from "../projects/project.service";
import { canUploadAttachment } from "../tasks/task.permission";

const attachmentRoute = new Hono();

// CLIENT role is blocked entirely: internal identities must never reach clients (masking at API level).
attachmentRoute.use("*", authMiddleware, internalOnly());

/** Max upload size (10 MB) */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Allowed upload types. Files are served from the API origin, so active content
 * (HTML, SVG, JS) is rejected to prevent stored XSS.
 */
const ALLOWED_MIME_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
	"text/plain",
	"text/csv",
	"application/zip",
	"application/x-zip-compressed",
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** Public origin of this API (works behind Railway/Vercel proxies) */
function publicOrigin(c: Context): string {
	if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
	const url = new URL(c.req.url);
	const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
	const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
	return `${proto ?? url.protocol.replace(":", "")}://${host ?? url.host}`;
}

/** Link attachments must be plain http(s) URLs (blocks javascript:/data: XSS) */
const linkAttachmentSchema = z.object({
	fileName: z.string().trim().min(1).max(255),
	fileUrl: z
		.string()
		.url()
		.refine((v) => /^https?:\/\//i.test(v), "fileUrl must be an http(s) URL"),
	mimeType: z.string().max(255).optional().nullable(),
	fileSize: z.number().int().nonnegative().optional().nullable(),
});

/** Throws 403/404 if the caller cannot access the task's project */
async function loadAccessibleTask(taskId: string, user: AuthUser) {
	const task = await prisma.task.findFirst({
		where: { id: taskId, deletedAt: null },
	});
	if (!task) throw new NotFoundError("Task", taskId);
	await projectService.checkProjectAccess(task.projectId, user);
	return task;
}

// GET /tasks/:id/attachments — authorized users
attachmentRoute.get("/:id/attachments", async (c) => {
	const user = c.get("user") as AuthUser;
	const taskId = getParam(c, "id");

	await loadAccessibleTask(taskId, user);

	const attachments = await prisma.taskAttachment.findMany({
		where: { taskId, deletedAt: null },
		orderBy: { createdAt: "desc" },
		include: {
			user: {
				select: { id: true, name: true },
			},
		},
	});

	return successResponse(c, attachments);
});

// POST /tasks/:id/attachments — PM or INTERNAL (same department)
attachmentRoute.post("/:id/attachments", async (c) => {
	const user = c.get("user") as AuthUser;
	const taskId = getParam(c, "id");

	const task = await loadAccessibleTask(taskId, user); // (Dimension 2: Department check)
	if (
		!canUploadAttachment(user, {
			id: task.id,
			status: task.status,
			assigneeId: task.assigneeId,
			departmentId: task.departmentId,
			projectId: task.projectId,
		})
	) {
		throw new ForbiddenError(
			"You can only upload attachments to tasks in your department",
		);
	}

	let finalFileName = "";
	let finalFileUrl = "";
	let finalMimeType: string | null = null;
	let finalFileSize: number | null = null;

	const contentType = c.req.header("content-type") || "";
	if (contentType.includes("multipart/form-data")) {
		const body = await c.req.parseBody();
		const file = body.file;
		if (!(file instanceof File)) throw new ValidationError("File is required");
		if (file.size > MAX_UPLOAD_BYTES) {
			throw new ValidationError("File is too large (max 10 MB)");
		}
		if (!ALLOWED_MIME_TYPES.has(file.type)) {
			throw new ValidationError(
				`File type "${file.type || "unknown"}" is not allowed`,
			);
		}

		const uniqueName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "")}`;
		const arrayBuffer = await file.arrayBuffer();
		await fs.writeFile(`uploads/${uniqueName}`, Buffer.from(arrayBuffer));

		const displayName =
			typeof body.fileName === "string" && body.fileName.trim()
				? body.fileName.trim().slice(0, 255)
				: file.name;
		finalFileName = displayName;
		finalFileUrl = `${publicOrigin(c)}/api/v1/uploads/${uniqueName}`;
		finalMimeType = file.type;
		finalFileSize = file.size;
	} else {
		const parsed = linkAttachmentSchema.safeParse(await c.req.json());
		if (!parsed.success) {
			throw new ValidationError(
				"Invalid attachment",
				parsed.error.flatten().fieldErrors,
			);
		}
		finalFileName = parsed.data.fileName;
		finalFileUrl = parsed.data.fileUrl;
		finalMimeType = parsed.data.mimeType ?? null;
		finalFileSize = parsed.data.fileSize ?? null;
	}

	const attachment = await prisma.taskAttachment.create({
		data: {
			taskId,
			uploadedBy: user.id,
			fileName: finalFileName,
			fileUrl: finalFileUrl,
			mimeType: finalMimeType,
			fileSize: finalFileSize,
		},
	});

	await prisma.taskAuditLog.create({
		data: {
			taskId,
			userId: user.id,
			changedColumn: "attachment",
			newValue: finalFileName,
		},
	});

	return successResponse(c, attachment, 201);
});

// DELETE /tasks/:id/attachments/:attachmentId — soft delete
attachmentRoute.delete(
	"/:id/attachments/:attachmentId",
	internalOnly(),
	async (c) => {
		const user = c.get("user") as AuthUser;
		const attachmentId = getParam(c, "attachmentId");

		const attachment = await prisma.taskAttachment.findFirst({
			where: { id: attachmentId, deletedAt: null },
		});
		if (!attachment) throw new NotFoundError("Attachment", attachmentId);

		// Only uploader or PM can delete
		if (user.role !== "PM" && attachment.uploadedBy !== user.id) {
			throw new ForbiddenError(
				"Only the uploader or PM can delete this attachment",
			);
		}

		await prisma.taskAttachment.update({
			where: { id: attachmentId },
			data: { deletedAt: new Date() },
		});

		await prisma.taskAuditLog.create({
			data: {
				taskId: attachment.taskId,
				userId: user.id,
				changedColumn: "attachment_deleted",
				oldValue: attachment.fileName,
			},
		});

		return successResponse(c, { message: "Attachment deleted successfully" });
	},
);

export { attachmentRoute };
