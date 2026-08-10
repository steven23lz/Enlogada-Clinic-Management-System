const bcrypt = require('bcryptjs');
const db = require('../config/database');
const userRepository = require('../repositories/userRepository');
const logger = require('../config/logger');

const seedUsers = async () => {
  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Password123!', salt);

    const usersToSeed = [
      { firstName: 'Super', lastName: 'Admin', email: 'admin@enlogada.com', role: 'SuperAdmin' },
      { firstName: 'Clinic', lastName: 'Manager', email: 'clinicadmin@enlogada.com', role: 'Admin' },
      { firstName: 'Maria', lastName: 'Santos', email: 'receptionist@enlogada.com', role: 'Receptionist' },
      { firstName: 'Juan', lastName: 'Cashier', email: 'cashier@enlogada.com', role: 'Cashier' },
      { firstName: 'Doc', lastName: 'Lab', email: 'lab@enlogada.com', role: 'Laboratory Staff' },
      { firstName: 'Sonya', lastName: 'Ultrasound', email: 'ultrasound@enlogada.com', role: 'Ultrasound Staff' },
      { firstName: 'Xavier', lastName: 'Ray', email: 'xray@enlogada.com', role: 'Xray Staff' },
      { firstName: 'Elena', lastName: 'Client', email: 'client@enlogada.com', role: 'Client' },
    ];

    for (const u of usersToSeed) {
      let existing = await userRepository.findByEmail(u.email);
      if (!existing) {
        const created = await userRepository.createUser(u.firstName, u.lastName, u.email, passwordHash, '09171234567');
        const roleId = await userRepository.findRoleIdByName(u.role);
        if (roleId) {
          await userRepository.assignRoleToUser(created.id, roleId);
        }
        logger.info(`Seeded user: ${u.email} with role: ${u.role}`);
      } else {
        logger.info(`User ${u.email} already exists.`);
      }
    }

    logger.info('All seed users ready!');
    process.exit(0);
  } catch (err) {
    logger.error('Seeding failed:', err);
    process.exit(1);
  }
};

seedUsers();
