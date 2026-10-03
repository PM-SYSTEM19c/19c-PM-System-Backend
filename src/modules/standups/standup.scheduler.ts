import { standupService } from "./standup.service";

/**
 * Background job — Daily Standup summaries.
 *
 * Runs once shortly after boot and then every hour. Each run generates
 * "yesterday" (in STANDUP_TIMEZONE) for every active project. Generation is
 * idempotent (an existing summary for a project/date is reused), so the hourly
 * tick is cheap and also covers server downtime / restarts around midnight.
 *
 * Disable with STANDUP_SCHEDULER=off (e.g. in tests or multi-instance deploys
 * where an external cron calls POST /standups/generate-all instead).
 */
const HOUR_MS = 60 * 60 * 1000;

export function startStandupScheduler() {
	if (process.env.STANDUP_SCHEDULER === "off") {
		console.log("⏸️  Daily standup scheduler disabled (STANDUP_SCHEDULER=off)");
		return;
	}

	let running = false;
	const tick = async () => {
		if (running) return; // never overlap runs
		running = true;
		try {
			const results = await standupService.generateForAllProjects();
			const failed = results.filter((r) => r.status === "error");
			if (failed.length > 0) {
				console.error("⚠️  Daily standup: some projects failed", failed);
			}
		} catch (err) {
			console.error("⚠️  Daily standup job failed:", err);
		} finally {
			running = false;
		}
	};

	setTimeout(tick, 5_000);
	setInterval(tick, HOUR_MS);
	console.log("🗓️  Daily standup scheduler started (hourly, idempotent)");
}
