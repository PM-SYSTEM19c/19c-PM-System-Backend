import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pm@assessment.test', password: 'Password123!' })
  });
  const json = await loginRes.json();
  const token = json.data.accessToken;
  const res = await fetch('http://localhost:3000/api/v1/tasks?filter[projectId]=cmuqxeqvf000eds9jwg2l3xaq&pageSize=100', {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('STATUS:', res.status);
  console.log('BODY:', await res.text());
}
main();
