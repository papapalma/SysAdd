/*
    Migration Script: Normalize milestones to separate table
    This migrates reportMilestones JSON data from Projects table to normalized Milestones table
*/

import { sequelize } from "./models/db.js";
import Project from "./models/Project.js";
import Milestone from "./models/Milestone.js";
import Report from "./models/Report.js";

console.log("🔧 Normalizing milestones data...\n");

try {
  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database!");

  // Step 1: Create Milestones table
  await sequelize.sync({ alter: false });
  console.log("✅ Milestones table created/verified");

  // Step 2: Migrate existing reportMilestones data
  const [projects] = await sequelize.query(`
    SELECT id, reportMilestones FROM Projects WHERE reportMilestones IS NOT NULL;
  `);

  console.log(`\n📊 Found ${projects.length} projects with milestone data`);

  let migratedCount = 0;
  for (const project of projects) {
    if (!project.reportMilestones) continue;

    try {
      const milestones = JSON.parse(project.reportMilestones);
      
      for (const milestone of milestones) {
        // Handle both old format (string dates) and new format (objects with id, date, description)
        const milestoneData = typeof milestone === 'string' 
          ? { date: milestone, description: null }
          : { date: milestone.date, description: milestone.description };

        const created = await Milestone.create({
          projectId: project.id,
          date: milestoneData.date,
          description: milestoneData.description || ''
        });

        // Update reports that reference the old milestone ID
        if (milestone.id) {
          await sequelize.query(`
            UPDATE Reports 
            SET milestoneId = ? 
            WHERE milestoneId = ? AND projectId = ?
          `, {
            replacements: [created.id, milestone.id, project.id]
          });
        }

        migratedCount++;
      }

      console.log(`  ✓ Migrated ${milestones.length} milestones for project #${project.id}`);
    } catch (err) {
      console.error(`  ✗ Error migrating project #${project.id}:`, err.message);
    }
  }

  console.log(`\n✅ Successfully migrated ${migratedCount} milestones!`);

  // Step 3: Drop the old reportMilestones column
  const [columns] = await sequelize.query(`
    SHOW COLUMNS FROM Projects LIKE 'reportMilestones';
  `);

  if (columns.length > 0) {
    await sequelize.query(`
      ALTER TABLE Projects DROP COLUMN reportMilestones;
    `);
    console.log("✅ Removed deprecated reportMilestones column from Projects table");
  }

  // Step 4: Convert milestoneId from VARCHAR to INT in Reports table
  const [reportColumns] = await sequelize.query(`
    SHOW COLUMNS FROM Reports WHERE Field = 'milestoneId';
  `);

  if (reportColumns.length > 0 && reportColumns[0].Type.includes('varchar')) {
    // First, set invalid string IDs to NULL
    await sequelize.query(`
      UPDATE Reports SET milestoneId = NULL WHERE milestoneId NOT REGEXP '^[0-9]+$';
    `);
    
    // Then change the column type
    await sequelize.query(`
      ALTER TABLE Reports MODIFY COLUMN milestoneId INT NULL;
    `);
    
    // Add foreign key constraint
    await sequelize.query(`
      ALTER TABLE Reports 
      ADD CONSTRAINT fk_reports_milestone 
      FOREIGN KEY (milestoneId) REFERENCES Milestones(id) ON DELETE SET NULL;
    `);
    
    console.log("✅ Converted Reports.milestoneId to INTEGER with foreign key constraint");
  }

  console.log("\n🎉 Database normalization complete!");
  console.log("\nDatabase structure is now properly normalized:");
  console.log("  • Projects table - stores project information");
  console.log("  • Milestones table - stores milestone dates and descriptions");
  console.log("  • Reports table - references milestones via foreign key");

  process.exit(0);
} catch (err) {
  console.error("❌ Migration failed:", err);
  process.exit(1);
}
