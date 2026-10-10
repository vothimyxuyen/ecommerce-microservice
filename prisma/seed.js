const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.role.upsert({
    where: { rolename: 'CUSTOMER' },
    update: {},
    create: { rolename: 'CUSTOMER' }
  });
  await prisma.role.upsert({
    where: { rolename: 'ADMIN' },
    update: {},
    create: { rolename: 'ADMIN' }
  });
  await prisma.membership.upsert({
    where: { mname: 'Basic' },
    update: {},
    create: { mname: 'Basic', score: 10 }
  });
}

main()
  .catch((error) => {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
