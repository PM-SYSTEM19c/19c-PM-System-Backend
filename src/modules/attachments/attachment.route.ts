import { Hono } from "hono";
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
import { canUploadAttachment } from "../tasks/task.permission";

const attachmentRoute = new Hono();

// CLIENT role is blocked entirely: internal identities must never reach clients (masking at API level).
attachmentRoute.use("*", authMiddleware, internalOnly());

// GET /tasks/:id/attachments — authorized users
attachmentRoute.get("/:id/attachments", async (c) => {
	const taskId = getParam(c, "id");

	const task = await prisma.task.findFirst({
		where: { id: taskId, deletedAt: null },
	});
	if (!task) throw new NotFoundError("Task", taskId);

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

	const task = await prisma.task.findFirst({
		where: { id: taskId, deletedAt: null },
	});
	if (!task) throw new NotFoundError("Task", taskId);

	// Check permission (Dimension 2: Department check)
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
	let finalMimeType = null;
	let finalFileSize = null;

	const contentType = c.req.header("content-type") || "";
	if (contentType.includes("multipart/form-data")) {
		const body = await c.req.parseBody();
		const file = body.file as File;
		if (!file) throw new ValidationError("File is required");

		const uniqueName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "")}`;
		const buffer = await file.arrayBuffer();
		await Bun.write(`uploads/${uniqueName}`, buffer);

		finalFileName = (body.fileName as string) || file.name;
		finalFileUrl = `http://localhost:3000/api/v1/uploads/${uniqueName}`;
		finalMimeType = file.type;
		finalFileSize = file.size;
	} else {
		const body = await c.req.json();
		if (!body.fileName || !body.fileUrl) {
			throw new ValidationError("fileName and fileUrl are required");
		}
		finalFileName = body.fileName;
		finalFileUrl = body.fileUrl;
		finalMimeType = body.mimeType || null;
		finalFileSize = body.fileSize || null;
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
