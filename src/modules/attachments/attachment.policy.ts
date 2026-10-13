export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Keep upload acceptance and physical download MIME types under one policy. */
export const ALLOWED_MIME_TYPES = new Set([
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

/** Link metadata is untrusted: never serve physical files as arbitrary active content. */
export function safeAttachmentMimeType(mimeType: string | null): string {
	return mimeType && ALLOWED_MIME_TYPES.has(mimeType)
		? mimeType
		: "application/octet-stream";
}
