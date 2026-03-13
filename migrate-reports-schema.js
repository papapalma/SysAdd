/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
    */

import { sequelize } from "./models/db.js";

console.log("🔄 Migrating Reports table schema to add comprehensive fields...\n");

try {
  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database!");

  // Add new columns to Reports table
  const alterations = [
    // Basic Information
    { name: 'reportType', sql: "ALTER TABLE Reports ADD COLUMN reportType ENUM('Progress Update', 'Milestone', 'Financial', 'Issue/Risk', 'Completion', 'General') DEFAULT 'General' NOT NULL AFTER description" },
    { name: 'status', sql: "ALTER TABLE Reports ADD COLUMN status ENUM('Draft', 'Published', 'Archived') DEFAULT 'Published' NOT NULL AFTER reportType" },
    
    // Progress & Timeline
    { name: 'progressPercentage', sql: "ALTER TABLE Reports ADD COLUMN progressPercentage DECIMAL(5, 2) DEFAULT 0 AFTER status" },
    { name: 'reportPeriodStart', sql: "ALTER TABLE Reports ADD COLUMN reportPeriodStart DATE AFTER progressPercentage" },
    { name: 'reportPeriodEnd', sql: "ALTER TABLE Reports ADD COLUMN reportPeriodEnd DATE AFTER reportPeriodStart" },
    
    // Financial Information
    { name: 'budgetAllocated', sql: "ALTER TABLE Reports ADD COLUMN budgetAllocated DECIMAL(15, 2) DEFAULT 0 AFTER reportPeriodEnd" },
    { name: 'budgetUsed', sql: "ALTER TABLE Reports ADD COLUMN budgetUsed DECIMAL(15, 2) DEFAULT 0 AFTER budgetAllocated" },
    { name: 'expenditureDetails', sql: "ALTER TABLE Reports ADD COLUMN expenditureDetails TEXT AFTER budgetUsed" },
    
    // Achievements & Milestones
    { name: 'achievements', sql: "ALTER TABLE Reports ADD COLUMN achievements TEXT AFTER expenditureDetails" },
    { name: 'milestonesReached', sql: "ALTER TABLE Reports ADD COLUMN milestonesReached TEXT AFTER achievements" },
    
    // Challenges & Issues
    { name: 'challenges', sql: "ALTER TABLE Reports ADD COLUMN challenges TEXT AFTER milestonesReached" },
    { name: 'risksIdentified', sql: "ALTER TABLE Reports ADD COLUMN risksIdentified TEXT AFTER challenges" },
    { name: 'mitigationActions', sql: "ALTER TABLE Reports ADD COLUMN mitigationActions TEXT AFTER risksIdentified" },
    
    // Future Plans
    { name: 'nextSteps', sql: "ALTER TABLE Reports ADD COLUMN nextSteps TEXT AFTER mitigationActions" },
    { name: 'recommendations', sql: "ALTER TABLE Reports ADD COLUMN recommendations TEXT AFTER nextSteps" },
    
    // Location & Team
    { name: 'location', sql: "ALTER TABLE Reports ADD COLUMN location VARCHAR(255) AFTER recommendations" },
    { name: 'teamMembers', sql: "ALTER TABLE Reports ADD COLUMN teamMembers TEXT AFTER location" },
    { name: 'beneficiaries', sql: "ALTER TABLE Reports ADD COLUMN beneficiaries VARCHAR(255) AFTER teamMembers" },
    
    // Media & Attachments
    { name: 'additionalImages', sql: "ALTER TABLE Reports ADD COLUMN additionalImages TEXT AFTER imageUrl" },
    { name: 'attachments', sql: "ALTER TABLE Reports ADD COLUMN attachments TEXT AFTER additionalImages" },
    
    // Metrics & KPIs
    { name: 'metricsData', sql: "ALTER TABLE Reports ADD COLUMN metricsData TEXT AFTER attachments" },
    
    // Approval & Review
    { name: 'approvalStatus', sql: "ALTER TABLE Reports ADD COLUMN approvalStatus ENUM('Pending', 'Approved', 'Rejected', 'Under Review') DEFAULT 'Approved' AFTER metricsData" },
    { name: 'reviewedBy', sql: "ALTER TABLE Reports ADD COLUMN reviewedBy INT AFTER approvalStatus" },
    { name: 'reviewNotes', sql: "ALTER TABLE Reports ADD COLUMN reviewNotes TEXT AFTER reviewedBy" },
    
    // Metadata
    { name: 'tags', sql: "ALTER TABLE Reports ADD COLUMN tags VARCHAR(255) AFTER reviewNotes" },
    { name: 'priority', sql: "ALTER TABLE Reports ADD COLUMN priority ENUM('Low', 'Medium', 'High', 'Critical') DEFAULT 'Medium' AFTER tags" },
    { name: 'isPublic', sql: "ALTER TABLE Reports ADD COLUMN isPublic BOOLEAN DEFAULT TRUE AFTER priority" },
    
    // Timestamps
    { name: 'updatedAt', sql: "ALTER TABLE Reports ADD COLUMN updatedAt DATETIME AFTER createdAt" }
  ];

  let successCount = 0;
  let skipCount = 0;

  for (const alteration of alterations) {
    try {
      await sequelize.query(alteration.sql);
      successCount++;
      console.log(`✓ Added column: ${alteration.name}`);
    } catch (err) {
      if (err.message && err.message.includes('Duplicate column name')) {
        skipCount++;
        console.log(`⊙ Column '${alteration.name}' already exists (skipped)`);
      } else {
        console.error(`✗ Error adding '${alteration.name}':`, err.message);
      }
    }
  }

  console.log(`\n✅ Migration complete!`);
  console.log(`   Columns added: ${successCount}`);
  console.log(`   Columns skipped (already exist): ${skipCount}`);
  console.log(`\n📊 Reports table now has comprehensive tracking fields for:`);
  console.log(`   • Report types and priorities`);
  console.log(`   • Progress tracking & timelines`);
  console.log(`   • Financial information`);
  console.log(`   • Achievements & milestones`);
  console.log(`   • Challenges & risk management`);
  console.log(`   • Future plans & recommendations`);
  console.log(`   • Location & team details`);
  console.log(`   • Media attachments`);
  console.log(`   • Approval workflows`);

} catch (error) {
  console.error("❌ Migration failed:", error.message);
  process.exit(1);
} finally {
  await sequelize.close();
  process.exit(0);
}
