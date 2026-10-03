import { serve } from "@hono/node-server";
import { app } from "./app";
import { env } from "./config/env";
import { applyDbHardening } from "./lib/db-hardening";
import { prisma } from "./lib/prisma";
import { startStandupScheduler } from "./modules/standups/standup.scheduler";

console.log(`🚀 Server starting on port ${env.PORT}...`);
console.log(`📝 Environment: ${env.NODE_ENV}`);

// DB-level guarantees (soft delete only, append-only audit log). Idempotent.
applyDbHardening(prisma)
	.then((r) => console.log(`🛡️  DB hardening applied (${r.tables} tables)`))
	.catch((err) => console.error("⚠️  DB hardening failed:", err));

serve(
	{
		fetch: app.fetch,
		port: env.PORT,
	},
	(info) => {
		console.log(`✅ Server running at http://localhost:${info.port}`);
		console.log(`🔗 API Base URL: http://localhost:${info.port}/api/v1`);
		console.log(`💚 Health check: http://localhost:${info.port}/api/v1/health`);
		startStandupScheduler();
	},
);
