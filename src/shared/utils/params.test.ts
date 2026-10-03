import { describe, expect, it } from "bun:test";
import { ValidationError } from "../errors";
import { getParam } from "./params";

describe("getParam", () => {
	it("should return the parameter value if it exists", () => {
		const mockContext = {
			req: {
				param: (name: string) => {
					if (name === "id") return "123";
					return undefined;
				},
			},
		} as any;

		const value = getParam(mockContext, "id");
		expect(value).toBe("123");
	});

	it("should throw a ValidationError if the parameter is missing", () => {
		const mockContext = {
			req: {
				param: () => undefined,
			},
		} as any;

		expect(() => getParam(mockContext, "id")).toThrow(ValidationError);
		expect(() => getParam(mockContext, "id")).toThrow(
			"Missing route param: id",
		);
	});
});
