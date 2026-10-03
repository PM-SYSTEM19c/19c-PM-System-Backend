import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const res = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pm@assessment.test', password: 'Password123!' })
  });
  const json = await res.json();
  const token = json.data.token;
  
  const delRes = await fetch('http://localhost:3000/api/v1/projects/cmuqxeqvf000eds9jwg2l3xaq/departments/cmuqxeqnd0000ds9j7q6pwp1q', {
    method: 'DELETE',
    headers: { Authorization: \Bearer \\ }
  });
  console.log('STATUS:', delRes.status);
  console.log('BODY:', await delRes.text());
}
main();
