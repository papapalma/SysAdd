/*
    Migration Script: Add capitalShare to Users table
    Adds capital share tracking for members
*/

import { sequelize } from "./models/db.js";

console.log("🔧 Adding capitalShare column to Users table...\n");

try {
  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database!");

  // Check if capitalShare column exists
  const [capitalShareCol] = await sequelize.query(`
    SHOW COLUMNS FROM Users LIKE 'capitalShare';
  `);

  if (capitalShareCol.length === 0) {
    // Add capitalShare with default value 0
    await sequelize.query(`
      ALTER TABLE Users 
      ADD COLUMN capitalShare DECIMAL(10, 2) NOT NULL DEFAULT 0;
    `);
    console.log("✅ Added capitalShare column to Users table");
    
    // Set capitalShare to 0 for all existing users
    await sequelize.query(`
      UPDATE Users 
      SET capitalShare = 0 
      WHERE capitalShare IS NULL;
    `);
    console.log("✅ Initialized capitalShare for existing users");
  } else {
    console.log("⚠️  capitalShare column already exists");
  }

  console.log("\n✅ Migration completed successfully!");
  process.exit(0);
} catch (err) {
  console.error("❌ Migration failed:", err);
  process.exit(1);
}
