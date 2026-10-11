import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { ERROR_CODES } from "./config/constants";
import { env } from "./config/env";
import { routes } from "./routes";
import { AppError } from "./shared/errors";

const app = new Hono().basePath("/api/v1");

// Global security headers (SEC-003)
app.use(
	"*",
	secureHeaders({
		crossOriginResourcePolicy: "cross-origin",
	}),
);

// Global middlewares
app.use(
	"*",
	cors({
		origin: env.CORS_ORIGIN.split(",")
			.map((o) => o.trim())
			.filter(Boolean),
		credentials: true,
	}),
);
app.use("*", logger());

// Global error handler
app.onError((err, c) => {
	if (err instanceof AppError) {
		return c.json(
			{
				success: false,
				error: {
					code: err.code,
					message: err.message,
					...(err.details ? { details: err.details } : {}),
				},
			},
			err.statusCode as any,
		);
	}

	// Prisma known errors
	if (err && typeof err === "object" && "code" in err) {
		const prismaError = err as any;
		if (prismaError.code === "P2002") {
			return c.json(
				{
					success: false,
					error: {
						code: ERROR_CODES.ALREADY_EXISTS,
						message: "A record with this value already exists",
					},
				},
				409,
			);
		}
		if (prismaError.code === "P2025") {
			return c.json(
				{
					success: false,
					error: { code: ERROR_CODES.NOT_FOUND, message: "Record not found" },
				},
				404,
			);
		}
	}

	console.error("Unhandled error:", err);
	return c.json(
		{
			success: false,
			error: {
				code: ERROR_CODES.INTERNAL_ERROR,
				message: "An unexpected error occurred",
			},
		},
		500,
	);
});

// 404 handler
app.notFound((c) => {
	return c.json(
		{
			success: false,
			error: {
				code: ERROR_CODES.NOT_FOUND,
				message: `Route ${c.req.method} ${c.req.path} not found`,
			},
		},
		404,
	);
});

// Health check
app.get("/health", (c) =>
	c.json({ status: "ok", timestamp: new Date().toISOString() }),
);

// Mount all routes
app.route("/", routes);

export { app };
