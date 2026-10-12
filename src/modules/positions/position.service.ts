import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../shared/errors";
import type {
	CreatePositionInput,
	UpdatePositionInput,
} from "./position.schema";

export class PositionService {
	async findAll() {
		return prisma.position.findMany({
			where: { deletedAt: null },
			orderBy: { name: "asc" },
		});
	}

	async findById(id: string) {
		const position = await prisma.position.findFirst({
			where: { id, deletedAt: null },
		});
		if (!position) throw new NotFoundError("Position", id);
		return position;
	}

	async create(input: CreatePositionInput) {
		return prisma.position.create({
			data: {
				name: input.name,
				description: input.description,
			},
		});
	}

	async update(id: string, input: UpdatePositionInput) {
		await this.findById(id);
		return prisma.position.update({
			where: { id },
			data: {
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.description !== undefined
					? { description: input.description }
					: {}),
			},
		});
	}

	async softDelete(id: string) {
		await this.findById(id);
		return prisma.position.update({
			where: { id },
			data: { deletedAt: new Date() },
		});
	}
}

export const positionService = new PositionService();
