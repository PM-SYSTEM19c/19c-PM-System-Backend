import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../shared/errors";
import type { ListQueryResult } from "../../shared/utils/pagination";
import type { UpdateUserInput } from "./user.schema";

export type UserUpdateData = Omit<UpdateUserInput, "position">;

const USER_PROFILE_SELECT = {
	id: true,
	name: true,
	email: true,
	role: true,
	status: true,
	positionId: true,
	position: { select: { id: true, name: true } },
	departmentId: true,
	department: { select: { id: true, name: true, code: true } },
	createdAt: true,
} satisfies Prisma.UserSelect;

export class UserService {
	async findAll(listQuery: ListQueryResult) {
		const { skip, take, orderBy } = listQuery;
		const whereClause: any = { AND: [{ deletedAt: null }, listQuery.where] };

		const [users, total] = await Promise.all([
			prisma.user.findMany({
				where: whereClause,
				skip,
				take,
				orderBy: orderBy as any,
				select: USER_PROFILE_SELECT,
			}),
			prisma.user.count({ where: whereClause }),
		]);

		return { data: users, total };
	}

	async findById(id: string) {
		const targetUser = await prisma.user.findFirst({
			where: { id, deletedAt: null },
			select: USER_PROFILE_SELECT,
		});

		if (!targetUser) throw new NotFoundError("User", id);
		return targetUser;
	}

	async update(id: string, updateData: UserUpdateData) {
		const targetUser = await prisma.user.findFirst({
			where: { id, deletedAt: null },
		});
		if (!targetUser) throw new NotFoundError("User", id);

		return prisma.user.update({
			where: { id },
			data: updateData,
			select: USER_PROFILE_SELECT,
		});
	}
}

export const userService = new UserService();
