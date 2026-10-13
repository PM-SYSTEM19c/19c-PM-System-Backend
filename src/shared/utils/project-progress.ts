/** Calculate the existing project progress consistently for internal and client APIs. */
export function projectProgress(tasks: readonly { status: string }[]) {
	const total = tasks.length;
	const done = tasks.filter((task) => task.status === "DONE").length;
	return {
		progress: total > 0 ? Math.round((done / total) * 100) : 0,
		taskStats: { total, done },
	};
}
