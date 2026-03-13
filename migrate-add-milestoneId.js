/*
    Migration Script: Add milestoneId column to Reports table
    Run this once to add the column linking reports to project milestones
*/

import { sequelize } from "./models/db.js";

console.log("🔧 Adding milestoneId column to Reports table...\n");

try {
  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database!");

  // Check if column already exists
  const [columns] = await sequelize.query(`
    SHOW COLUMNS FROM Reports LIKE 'milestoneId';
  `);

  if (columns.length > 0) {
    console.log("⚠️  Column 'milestoneId' already exists. No changes needed.");
  } else {
    // Add the milestoneId column
    await sequelize.query(`
      ALTER TABLE Reports 
      ADD COLUMN milestoneId VARCHAR(255) NULL 
      AFTER userId;
    `);
    console.log("✅ Successfully added 'milestoneId' column to Reports table!");
  }

  process.exit(0);
} catch (err) {
  console.error("❌ Migration failed:", err);
  process.exit(1);
}
