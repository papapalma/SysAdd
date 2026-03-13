/*
    Migration Script: Add timestamps to Projects table
    Handles existing data properly
*/

import { sequelize } from "./models/db.js";

console.log("🔧 Adding timestamp columns to Projects table...\n");

try {
  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database!");

  // Check if createdAt column exists
  const [createdAtCol] = await sequelize.query(`
    SHOW COLUMNS FROM Projects LIKE 'createdAt';
  `);

  if (createdAtCol.length === 0) {
    // Add createdAt with default value for existing rows
    await sequelize.query(`
      ALTER TABLE Projects 
      ADD COLUMN createdAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP;
    `);
    console.log("✅ Added createdAt column to Projects table");
    
    // Set createdAt for existing rows that have NULL
    await sequelize.query(`
      UPDATE Projects 
      SET createdAt = CURRENT_TIMESTAMP 
      WHERE createdAt IS NULL;
    `);
    console.log("✅ Set createdAt for existing projects");
  } else {
    console.log("⚠️  createdAt column already exists");
  }

  // Check if updatedAt column exists
  const [updatedAtCol] = await sequelize.query(`
    SHOW COLUMNS FROM Projects LIKE 'updatedAt';
  `);

  if (updatedAtCol.length === 0) {
    // Add updatedAt with default value
    await sequelize.query(`
      ALTER TABLE Projects 
      ADD COLUMN updatedAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
    `);
    console.log("✅ Added updatedAt column to Projects table");
    
    // Set updatedAt for existing rows
    await sequelize.query(`
      UPDATE Projects 
      SET updatedAt = CURRENT_TIMESTAMP 
      WHERE updatedAt IS NULL;
    `);
    console.log("✅ Set updatedAt for existing projects");
  } else {
    console.log("⚠️  updatedAt column already exists");
  }

  console.log("\n🎉 Migration complete!");
  process.exit(0);
} catch (err) {
  console.error("❌ Migration failed:", err);
  process.exit(1);
}
