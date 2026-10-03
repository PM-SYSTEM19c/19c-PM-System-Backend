import type { Context, Next } from "hono";
import { ERROR_CODES } from "../config/constants";
import { AppError } from "../shared/errors";
import { errorResponse } from "../shared/response";

/**
 * Global error handler middleware
 * Catches all errors and returns standardized error responses
 */
export async function errorMiddleware(c: Context, next: Next) {
	try {
		await next();
	} catch (error) {
		if (error instanceof AppError) {
			return errorResponse(
				c,
				error.code,
				error.message,
				error.statusCode,
				error.details,
			);
		}

		// Prisma known errors
		if (error && typeof error === "object" && "code" in error) {
			const prismaError = error as {
				code: string;
				meta?: Record<string, unknown>;
			};

			if (prismaError.code === "P2002") {
				return errorResponse(
					c,
					ERROR_CODES.ALREADY_EXISTS,
					"A record with this value already exists",
					409,
					prismaError.meta,
				);
			}

			if (prismaError.code === "P2025") {
				return errorResponse(c, ERROR_CODES.NOT_FOUND, "Record not found", 404);
			}
		}

		// Unknown errors
		console.error("Unhandled error:", error);
		return errorResponse(
			c,
			ERROR_CODES.INTERNAL_ERROR,
			"An unexpected error occurred",
			500,
		);
	}
}
