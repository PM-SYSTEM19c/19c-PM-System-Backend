import { PrismaClient, Role, TaskStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BCRYPT_SALT_ROUNDS = 12;

async function main() {
  console.log("🌱 Starting seed...");

  console.log("📁 Creating departments...");
  const deptIT = await prisma.department.upsert({
    where: { code: "IT" }, update: {}, create: { name: "IT & Teknikal", code: "IT", description: "Tim teknologi informasi dan pengembangan sistem" }
  });
  const deptBisnis = await prisma.department.upsert({
    where: { code: "BISNIS" }, update: {}, create: { name: "Bisnis", code: "BISNIS", description: "Tim operasional dan pengembangan bisnis" }
  });
  console.log(`  ✅ Departments: ${deptIT.name}, ${deptBisnis.name}`);

  console.log("👔 Creating positions...");
  const posUIUX = await prisma.position.upsert({ where: { name: "UI/UX Designer" }, update: {}, create: { name: "UI/UX Designer" } });
  const posFrontend = await prisma.position.upsert({ where: { name: "Frontend Developer" }, update: {}, create: { name: "Frontend Developer" } });
  const posBackend = await prisma.position.upsert({ where: { name: "Backend Developer" }, update: {}, create: { name: "Backend Developer" } });
  const posMarketing = await prisma.position.upsert({ where: { name: "Marketing" }, update: {}, create: { name: "Marketing" } });
  console.log("  ✅ Positions created");

  console.log("👤 Creating users...");
  const passwordHash = await bcrypt.hash("Password123!", BCRYPT_SALT_ROUNDS);

  const pm = await prisma.user.upsert({
    where: { email: "pm@assessment.test" }, update: {}, create: { name: "Product Manager", email: "pm@assessment.test", passwordHash, role: Role.PM, departmentId: null }
  });

  const uiuxUser = await prisma.user.upsert({
    where: { email: "uiux@assessment.test" }, update: {}, create: { name: "Alya", email: "uiux@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posUIUX.id, departmentId: deptIT.id }
  });
  const frontendUser = await prisma.user.upsert({
    where: { email: "frontend@assessment.test" }, update: {}, create: { name: "Budi", email: "frontend@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posFrontend.id, departmentId: deptIT.id }
  });
  const backendUser = await prisma.user.upsert({
    where: { email: "backend@assessment.test" }, update: {}, create: { name: "Charlie", email: "backend@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posBackend.id, departmentId: deptIT.id }
  });
  const marketingUser = await prisma.user.upsert({
    where: { email: "marketing@assessment.test" }, update: {}, create: { name: "Diana", email: "marketing@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posMarketing.id, departmentId: deptBisnis.id }
  });
  const clientUser = await prisma.user.upsert({
    where: { email: "client@assessment.test" }, update: {}, create: { name: "Client ABC", email: "client@assessment.test", passwordHash, role: Role.CLIENT, departmentId: null }
  });

  await prisma.user.upsert({ where: { email: "frontend2@assessment.test" }, update: {}, create: { name: "Fikri", email: "frontend2@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posFrontend.id, departmentId: deptIT.id }});
  await prisma.user.upsert({ where: { email: "frontend3@assessment.test" }, update: {}, create: { name: "Gita", email: "frontend3@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posFrontend.id, departmentId: deptIT.id }});
  await prisma.user.upsert({ where: { email: "backend2@assessment.test" }, update: {}, create: { name: "Hasan", email: "backend2@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posBackend.id, departmentId: deptIT.id }});
  await prisma.user.upsert({ where: { email: "backend3@assessment.test" }, update: {}, create: { name: "Indah", email: "backend3@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posBackend.id, departmentId: deptIT.id }});
  await prisma.user.upsert({ where: { email: "uiux2@assessment.test" }, update: {}, create: { name: "Joko", email: "uiux2@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posUIUX.id, departmentId: deptIT.id }});
  await prisma.user.upsert({ where: { email: "marketing2@assessment.test" }, update: {}, create: { name: "Kevin", email: "marketing2@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posMarketing.id, departmentId: deptBisnis.id }});
  await prisma.user.upsert({ where: { email: "marketing3@assessment.test" }, update: {}, create: { name: "Lina", email: "marketing3@assessment.test", passwordHash, role: Role.INTERNAL, positionId: posMarketing.id, departmentId: deptBisnis.id }});
  console.log("  ✅ Users created");

  console.log("📋 Creating demo project...");
  let project = await prisma.project.findFirst({ where: { name: "E-Commerce Website" } });
  if (!project) {
    project = await prisma.project.create({
      data: { name: "E-Commerce Website", description: "Membangun platform e-commerce baru untuk klien ritel.", clientId: clientUser.id, departments: { create: [{ departmentId: deptIT.id }, { departmentId: deptBisnis.id }] } }
    });
  }

  const proj1 = await prisma.project.findFirst({ where: { name: "Mobile App Redesign" }}) || await prisma.project.create({
    data: { name: "Mobile App Redesign", description: "Redesigning the main customer mobile application.", clientId: clientUser.id, departments: { create: [{ departmentId: deptIT.id }, { departmentId: deptBisnis.id }] } }
  });
  const proj2 = await prisma.project.findFirst({ where: { name: "E-Commerce Platform Migration" }}) || await prisma.project.create({
    data: { name: "E-Commerce Platform Migration", description: "Migrating the legacy e-commerce platform.", clientId: clientUser.id, departments: { create: [{ departmentId: deptIT.id }] } }
  });
  console.log(`  ✅ Projects created`);

  console.log("📝 Creating demo tasks...");
  const tasksCount = await prisma.task.count();
  if (tasksCount === 0) {
    const task1 = await prisma.task.create({ data: { projectId: project.id, title: "Buat Wireframe Homepage", departmentId: deptIT.id, assigneeId: uiuxUser.id, status: TaskStatus.DONE, clientVisible: true, version: 1 } });
    const task2 = await prisma.task.create({ data: { projectId: project.id, title: "Homepage Development", departmentId: deptIT.id, assigneeId: frontendUser.id, status: TaskStatus.IN_PROGRESS, clientVisible: true, version: 1 } });
    const task3 = await prisma.task.create({ data: { projectId: project.id, title: "Setup Database & Auth", departmentId: deptIT.id, assigneeId: backendUser.id, status: TaskStatus.TODO, clientVisible: false, version: 1 } });
    const task4 = await prisma.task.create({ data: { projectId: project.id, title: "Rencana Campaign", departmentId: deptBisnis.id, assigneeId: marketingUser.id, status: TaskStatus.TODO, clientVisible: true, version: 1 } });

    const uiux2 = await prisma.user.findUnique({ where: { email: "uiux2@assessment.test" } });
    const fe2 = await prisma.user.findUnique({ where: { email: "frontend2@assessment.test" } });
    await prisma.task.create({ data: { projectId: proj1.id, title: "Design Mobile App Mockups", departmentId: deptIT.id, assigneeId: uiux2?.id, status: "DONE", clientVisible: true, version: 1 } });
    await prisma.task.create({ data: { projectId: proj1.id, title: "Implement Mobile Auth Flow", departmentId: deptIT.id, assigneeId: fe2?.id, status: "IN_PROGRESS", clientVisible: true, version: 1 } });
    await prisma.taskDependency.create({ data: { taskId: task2.id, dependsOnId: task1.id } });
    await prisma.taskDependency.create({ data: { taskId: task2.id, dependsOnId: task3.id } });
  }
  console.log("🎉 Seed completed successfully!");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
