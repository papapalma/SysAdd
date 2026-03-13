/*
    Migration Script: Add reportMilestones column to Projects table
    Run this once to add the new column for tracking report submission deadlines
*/

import { sequelize } from "./models/db.js";

console.log("🔧 Adding reportMilestones column to Projects table...\n");

try {
  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database!");

  // Check if column already exists
  const [columns] = await sequelize.query(`
    SHOW COLUMNS FROM Projects LIKE 'reportMilestones';
  `);

  if (columns.length > 0) {
    console.log("⚠️  Column 'reportMilestones' already exists. No changes needed.");
  } else {
    // Add the reportMilestones column
    await sequelize.query(`
      ALTER TABLE Projects 
      ADD COLUMN reportMilestones TEXT NULL 
      AFTER timelineEnd;
    `);
    console.log("✅ Successfully added 'reportMilestones' column to Projects table!");
  }

  process.exit(0);
} catch (err) {
  console.error("❌ Migration failed:", err);
  process.exit(1);
}
