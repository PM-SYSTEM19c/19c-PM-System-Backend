import { PrismaClient, Role, TaskStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('?? Starting dummy data insertion...');
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const deptIT = await prisma.department.findUnique({ where: { code: 'IT' } });
  const deptBisnis = await prisma.department.findUnique({ where: { code: 'BISNIS' } });
  
  if (!deptIT || !deptBisnis) {
    console.error('Departments not found. Run seed.ts first.');
    return;
  }

  const pm = await prisma.user.findUnique({ where: { email: 'pm@assessment.test' } });
  const client = await prisma.user.findUnique({ where: { email: 'client@assessment.test' } });

  console.log('?? Adding users with same positions...');
  // Frontend Developers
  await prisma.user.upsert({
    where: { email: 'frontend2@assessment.test' },
    update: {},
    create: { name: 'Fikri', email: 'frontend2@assessment.test', passwordHash: passwordHash, role: Role.INTERNAL, position: 'Frontend Developer', departmentId: deptIT.id },
  });
  await prisma.user.upsert({
    where: { email: 'frontend3@assessment.test' },
    update: {},
    create: { name: 'Gita', email: 'frontend3@assessment.test', passwordHash: passwordHash, role: Role.INTERNAL, position: 'Frontend Developer', departmentId: deptIT.id },
  });
  // Backend Developers
  await prisma.user.upsert({
    where: { email: 'backend2@assessment.test' },
    update: {},
    create: { name: 'Hasan', email: 'backend2@assessment.test', passwordHash: passwordHash, role: Role.INTERNAL, position: 'Backend Developer', departmentId: deptIT.id },
  });
  await prisma.user.upsert({
    where: { email: 'backend3@assessment.test' },
    update: {},
    create: { name: 'Indah', email: 'backend3@assessment.test', passwordHash: passwordHash, role: Role.INTERNAL, position: 'Backend Developer', departmentId: deptIT.id },
  });
  // UI/UX
  await prisma.user.upsert({
    where: { email: 'uiux2@assessment.test' },
    update: {},
    create: { name: 'Joko', email: 'uiux2@assessment.test', passwordHash: passwordHash, role: Role.INTERNAL, position: 'UI/UX Designer', departmentId: deptIT.id },
  });
  
  // Bisnis (Marketing)
  await prisma.user.upsert({
    where: { email: 'marketing2@assessment.test' },
    update: {},
    create: { name: 'Kevin', email: 'marketing2@assessment.test', passwordHash: passwordHash, role: Role.INTERNAL, position: 'Marketing', departmentId: deptBisnis.id },
  });
  await prisma.user.upsert({
    where: { email: 'marketing3@assessment.test' },
    update: {},
    create: { name: 'Lina', email: 'marketing3@assessment.test', passwordHash: passwordHash, role: Role.INTERNAL, position: 'Marketing', departmentId: deptBisnis.id },
  });

  console.log('?? Creating dummy projects...');
  const proj1 = await prisma.project.create({
    data: {
      name: 'Mobile App Redesign',
      description: 'Redesigning the main customer mobile application to improve UX and modern aesthetics.',
      clientId: client?.id,
      departments: {
        create: [
          { departmentId: deptIT.id },
          { departmentId: deptBisnis.id }
        ]
      }
    }
  });

  const proj2 = await prisma.project.create({
    data: {
      name: 'E-Commerce Platform Migration',
      description: 'Migrating the legacy e-commerce platform to a new Next.js based headless architecture.',
      clientId: client?.id,
      departments: {
        create: [
          { departmentId: deptIT.id }
        ]
      }
    }
  });

  console.log('? Dummy projects created:', proj1.name, proj2.name);
  
  // Tasks for Mobile App Redesign
  const fe2 = await prisma.user.findUnique({ where: { email: 'frontend2@assessment.test' } });
  const uiux2 = await prisma.user.findUnique({ where: { email: 'uiux2@assessment.test' } });
  
  await prisma.task.create({
    data: {
      projectId: proj1.id,
      title: 'Design Mobile App Mockups',
      description: 'Create Figma mockups for the new mobile app design.',
      departmentId: deptIT.id,
      assigneeId: uiux2?.id,
      status: 'DONE',
      clientVisible: true,
      version: 1
    }
  });

  await prisma.task.create({
    data: {
      projectId: proj1.id,
      title: 'Implement Mobile Auth Flow',
      description: 'Implement login and registration screens.',
      departmentId: deptIT.id,
      assigneeId: fe2?.id,
      status: 'IN_PROGRESS',
      clientVisible: true,
      version: 1
    }
  });
  
  console.log('? Dummy data insertion complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
