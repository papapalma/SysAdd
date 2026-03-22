/*
    Migration Script: Add extended user profile fields to Users table
    Safe to run multiple times
*/

import { DataTypes } from 'sequelize';
import { sequelize } from './models/db.js';

console.log('Adding extended user profile fields to Users table...\n');

try {
  await sequelize.authenticate();
  console.log('Connected to MySQL database');

  const qi = sequelize.getQueryInterface();
  const usersTable = await qi.describeTable('Users');

  const columnsToAdd = [
    { name: 'firstName', definition: { type: DataTypes.STRING, allowNull: true } },
    { name: 'middleName', definition: { type: DataTypes.STRING, allowNull: true } },
    { name: 'maidenName', definition: { type: DataTypes.STRING, allowNull: true } },
    { name: 'birthday', definition: { type: DataTypes.DATEONLY, allowNull: true } },
    { name: 'address', definition: { type: DataTypes.STRING, allowNull: true } },
    { name: 'placeOfBirth', definition: { type: DataTypes.STRING, allowNull: true } },
  ];

  for (const column of columnsToAdd) {
    if (!usersTable[column.name]) {
      await qi.addColumn('Users', column.name, column.definition);
      console.log(`Added column: ${column.name}`);
    } else {
      console.log(`Column already exists: ${column.name}`);
    }
  }

  console.log('\nMigration complete');
  process.exit(0);
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
}
