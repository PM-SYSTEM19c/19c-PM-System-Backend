import bcrypt from "bcryptjs";
import { BCRYPT_SALT_ROUNDS, ERROR_CODES } from "../../config/constants";
import { signToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import {
	AppError,
	NotFoundError,
	UnauthorizedError,
} from "../../shared/errors";
import type { LoginInput, RegisterInput } from "./auth.schema";

export class AuthService {
	/**
	 * Register a new user
	 */
	async register(input: RegisterInput) {
		// Check if email already exists
		const existing = await prisma.user.findFirst({
			where: { email: input.email },
		});

		if (existing) {
			throw new AppError(
				ERROR_CODES.ALREADY_EXISTS,
				409,
				"Email already registered",
			);
		}

		// Department and Position will be assigned later by PM for INTERNAL role
		const departmentId = input.departmentId || null;

		const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

		const user = await prisma.user.create({
			data: {
				name: input.name,
				email: input.email,
				passwordHash,
				role: input.role,
				departmentId,
				status: "PENDING",
			},
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				departmentId: true,
				department: {
					select: {
						id: true,
						name: true,
						code: true,
					},
				},
			},
		});

		// No token is generated because they are pending approval
		return {
			message: "Registration successful. Please wait for PM approval.",
			user,
		};
	}

	/**
	 * Login with email and password
	 */
	async login(input: LoginInput) {
		const user = await prisma.user.findFirst({
			where: {
				email: input.email,
				deletedAt: null,
			},
			include: {
				department: {
					select: {
						id: true,
						name: true,
						code: true,
					},
				},
			},
		});

		if (!user) {
			throw new UnauthorizedError("Invalid email or password");
		}

		if (user.status === "PENDING") {
			throw new UnauthorizedError("Your account is pending PM approval");
		}

		if (user.status === "REJECTED") {
			throw new UnauthorizedError("Your account registration was rejected");
		}

		const isPasswordValid = await bcrypt.compare(
			input.password,
			user.passwordHash,
		);

		if (!isPasswordValid) {
			throw new UnauthorizedError("Invalid email or password");
		}

		const token = signToken({
			sub: user.id,
			role: user.role,
			departmentId: user.departmentId,
		});

		return {
			accessToken: token,
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
				departmentId: user.departmentId,
				department: user.department,
			},
		};
	}

	/**
	 * Get current authenticated user profile
	 */
	async getMe(userId: string) {
		const user = await prisma.user.findFirst({
			where: {
				id: userId,
				deletedAt: null,
			},
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				departmentId: true,
				department: {
					select: {
						id: true,
						name: true,
						code: true,
					},
				},
				createdAt: true,
			},
		});

		if (!user) {
			throw new NotFoundError("User");
		}

		return user;
	}
}

export const authService = new AuthService();
