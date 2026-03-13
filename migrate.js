
    /*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */

  import "dotenv/config";
  import { sequelize } from "./models/db.js";
// Import all models so Sequelize registers them before sync
import { User } from "./models/userModel.js";
import Project from "./models/Project.js";
import Milestone from "./models/Milestone.js";
import Report from "./models/Report.js";
import Content from "./models/Content.js";
import Log from "./models/Log.js";
import Faq from "./models/Faq.js";
import inquirer from "inquirer";

  const isProd = process.env.NODE_ENV === "production";
  const seedDefaultUsers = process.env.SEED_DEFAULT_USERS === "true" || !isProd;

// Determine DB name from sequelize config so we create the same DB that sequelize will connect to
const DB_NAME = (sequelize.config && (sequelize.config.database || sequelize.config.db)) || 'appdev';
// Avoid destructive prompts; just ensure DB exists without dropping data
await sequelize.query(`CREATE DATABASE IF NOT EXISTS ${DB_NAME};`);
console.log(`✅ Database '${DB_NAME}' ensured (no data dropped)`);

try {
  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database!");
  
  // IMPORTANT: Only run this once per database setup to avoid creating duplicate indexes
  // If you need to re-sync, first run: node fix-indexes.js
  // Using sync() without alter to avoid creating duplicate indexes
  await sequelize.sync();
  console.log("✅ Tables synced for all models!");

  // --- Seed data ---
  console.log("🌱 Seeding initial data (idempotent, no overwrites)...");
  // Users (optional, controlled via SEED_DEFAULT_USERS)
  if (seedDefaultUsers) {
    const bcrypt = (await import("bcryptjs")).default;
    const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@micaco.ph";
    const memberEmail = process.env.SEED_MEMBER_EMAIL || "member@micaco.ph";
    const secretaryEmail = process.env.SEED_SECRETARY_EMAIL || "secretary@micaco.ph";

    const adminPasswordPlain = process.env.SEED_ADMIN_PASSWORD || (isProd ? "" : "admin123");
    const memberPasswordPlain = process.env.SEED_MEMBER_PASSWORD || (isProd ? "" : "member123");
    const secretaryPasswordPlain = process.env.SEED_SECRETARY_PASSWORD || (isProd ? "" : "secretary123");

    const missingProdSecrets = isProd
      ? [
          ["SEED_ADMIN_PASSWORD", adminPasswordPlain],
          ["SEED_MEMBER_PASSWORD", memberPasswordPlain],
          ["SEED_SECRETARY_PASSWORD", secretaryPasswordPlain],
        ]
          .filter(([_, value]) => !value)
          .map(([key]) => key)
      : [];

    if (missingProdSecrets.length) {
      throw new Error(
        `In production, set passwords for seeded users via: ${missingProdSecrets.join(", ")}`
      );
    }

    const adminPassword = adminPasswordPlain
      ? await bcrypt.hash(adminPasswordPlain, 10)
      : "";
    const memberPassword = memberPasswordPlain
      ? await bcrypt.hash(memberPasswordPlain, 10)
      : "";
    const secretaryPassword = secretaryPasswordPlain
      ? await bcrypt.hash(secretaryPasswordPlain, 10)
      : "";

    const [admin] = await User.findOrCreate({
      where: { email: adminEmail },
      defaults: { name: "Admin User", password: adminPassword, role: "ADMIN", status: "Active" },
    });
    const [member] = await User.findOrCreate({
      where: { email: memberEmail },
      defaults: { name: "Member User", password: memberPassword, role: "MEMBER", status: "Active" },
    });
    const [secretary] = await User.findOrCreate({
      where: { email: secretaryEmail },
      defaults: { name: "Secretary User", password: secretaryPassword, role: "SECRETARY", status: "Active" },
    });

    console.log("✅ Default accounts ensured.");
    if (!isProd) {
      console.log("  Admin:     %s / %s", adminEmail, adminPasswordPlain || "(not set)");
      console.log("  Secretary: %s / %s", secretaryEmail, secretaryPasswordPlain || "(not set)");
      console.log("  Member:    %s / %s", memberEmail, memberPasswordPlain || "(not set)");
    } else {
      console.log(
        "ℹ️ Default users seeded using provided SEED_* credentials. Share passwords securely outside logs."
      );
    }
  } else {
    console.log("ℹ️ Skipping default user seeding (SEED_DEFAULT_USERS not enabled in production).");
  }

  // Content
  await Content.findOrCreate({ where: { key: 'hero' }, defaults: { value: JSON.stringify({ title: 'Welcome to MICACO', subtitle: 'Invest in community projects' }) } });
  await Content.findOrCreate({ where: { key: 'about' }, defaults: { value: JSON.stringify({ text: 'MICACO empowers members to fund local initiatives.' }) } });

  // Projects - Simplified for project management
  const [p1] = await Project.findOrCreate({ where: { title: 'Solar Farm' }, defaults: { description: 'Community solar project', category: 'Technology', status: 'Active' } });
  const [p2] = await Project.findOrCreate({ where: { title: 'Water System' }, defaults: { description: 'Clean water infrastructure', category: 'Infrastructure', status: 'Active' } });

  // Reports - Seed sample reports for the projects
  const reportCount = await Report.count();
  if (reportCount === 0) {
    await Report.bulkCreate([
      { projectId: p1.id, userId: admin.id, title: 'Solar Farm Project Kickoff', description: 'We are excited to announce the official start of our community solar farm project. Phase 1 site preparation has begun.', imageUrl: null },
      { projectId: p2.id, userId: secretary.id, title: 'Water System Planning Complete', description: 'The engineering team has finalized the water distribution system design. Construction to begin next month.', imageUrl: null }
    ]);
  }

  // Logs
  // Log seeding message once
  const logExists = await Log.findOne({ where: { message: 'Database seeded' } });
  if (!logExists) {
    await Log.bulkCreate([
      { level: 'INFO', message: 'Database seeded', meta: JSON.stringify({ users: 2, projects: 2 }) },
      { level: 'INFO', message: 'Admin user created', meta: JSON.stringify({ email: 'admin@micaco.ph' }) }
    ]);
  }

  // FAQs seed
  const faqSeeds = [
    { question: 'How do I become a member?', answer: 'Register online, submit required documents, and pay the ₱500 membership fee.', keywords: JSON.stringify(['member','register','join']) },
    { question: 'How do I view project reports?', answer: 'All project updates and announcements are available in the Reports section after logging in.', keywords: JSON.stringify(['reports','updates','announcements']) },
    { question: 'Who can create projects?', answer: 'Administrators and Secretaries can create and manage cooperative projects.', keywords: JSON.stringify(['projects','create','admin','secretary']) },
    { question: 'Contact information', answer: 'Email info@micaco.ph; Phone +63 123 456 7890; Address Mindoro Island, Philippines.', keywords: JSON.stringify(['contact','email','phone','address']) }
  ];
  for (const f of faqSeeds) {
    await Faq.findOrCreate({ where: { question: f.question }, defaults: f });
  }

  console.log("✅ Seeding complete!");
  console.log("\n📋 Default Accounts Created:");
  console.log("  Admin:     admin@micaco.ph / admin123");
  console.log("  Secretary: secretary@micaco.ph / secretary123");
  console.log("  Member:    member@micaco.ph / member123");
} catch (err) {
  console.error("❌ Migration failed:", err);
} finally {
  process.exit();
};
