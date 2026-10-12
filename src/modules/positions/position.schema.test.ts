import { describe, expect, it } from "bun:test";
import { createPositionSchema, updatePositionSchema } from "./position.schema";

describe("Position Schemas", () => {
	describe("createPositionSchema", () => {
		it("validates a valid position payload", () => {
			const res = createPositionSchema.safeParse({
				name: "Senior Backend Engineer",
				description: "Responsible for backend architecture and APIs",
			});
			expect(res.success).toBe(true);
			if (res.success) {
				expect(res.data.name).toBe("Senior Backend Engineer");
			}
		});

		it("rejects an empty name", () => {
			const res = createPositionSchema.safeParse({
				name: "   ",
				description: "Some description",
			});
			expect(res.success).toBe(false);
		});

		it("allows optional null or omitted description", () => {
			const res1 = createPositionSchema.safeParse({ name: "QA Lead" });
			expect(res1.success).toBe(true);

			const res2 = createPositionSchema.safeParse({
				name: "QA Lead",
				description: null,
			});
			expect(res2.success).toBe(true);
		});
	});

	describe("updatePositionSchema", () => {
		it("allows updating just name or just description", () => {
			const res1 = updatePositionSchema.safeParse({ name: "Tech Lead" });
			expect(res1.success).toBe(true);

			const res2 = updatePositionSchema.safeParse({
				description: "Updated description",
			});
			expect(res2.success).toBe(true);
		});

		it("rejects an empty name string if provided", () => {
			const res = updatePositionSchema.safeParse({ name: "  " });
			expect(res.success).toBe(false);
		});
	});
});
