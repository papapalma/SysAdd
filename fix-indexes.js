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

import { sequelize } from "./models/db.js";

console.log("🔧 Fixing indexes on Contents table...\n");

try {
  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database!");

  // Get all indexes on the Contents table
  const [indexes] = await sequelize.query(`
    SHOW INDEX FROM Contents;
  `);

  console.log(`\n📊 Found ${indexes.length} index entries on Contents table\n`);

  // Group indexes by Key_name
  const indexGroups = {};
  indexes.forEach(idx => {
    if (!indexGroups[idx.Key_name]) {
      indexGroups[idx.Key_name] = [];
    }
    indexGroups[idx.Key_name].push(idx);
  });

  console.log("📋 Current indexes:");
  Object.keys(indexGroups).forEach(keyName => {
    console.log(`   - ${keyName} (${indexGroups[keyName].length} columns)`);
  });

  // Drop all non-PRIMARY indexes
  console.log("\n🗑️  Dropping all non-PRIMARY indexes...");
  for (const keyName of Object.keys(indexGroups)) {
    if (keyName !== 'PRIMARY') {
      try {
        await sequelize.query(`ALTER TABLE Contents DROP INDEX \`${keyName}\`;`);
        console.log(`   ✓ Dropped index: ${keyName}`);
      } catch (err) {
        console.log(`   ⚠️  Could not drop ${keyName}: ${err.message}`);
      }
    }
  }

  // Now recreate only the necessary unique index on 'key' column
  console.log("\n✨ Creating unique index on 'key' column...");
  try {
    await sequelize.query(`ALTER TABLE Contents ADD UNIQUE INDEX \`Contents_key_unique\` (\`key\`);`);
    console.log("   ✓ Created unique index on 'key' column");
  } catch (err) {
    if (err.message.includes('Duplicate')) {
      console.log("   ⚠️  Index already exists, skipping");
    } else {
      console.log(`   ⚠️  Error: ${err.message}`);
    }
  }

  // Verify final state
  const [finalIndexes] = await sequelize.query(`SHOW INDEX FROM Contents;`);
  const finalGroups = {};
  finalIndexes.forEach(idx => {
    if (!finalGroups[idx.Key_name]) {
      finalGroups[idx.Key_name] = [];
    }
    finalGroups[idx.Key_name].push(idx);
  });

  console.log("\n✅ Final indexes:");
  Object.keys(finalGroups).forEach(keyName => {
    console.log(`   - ${keyName}`);
  });

  console.log("\n🎉 Index cleanup complete!");
  console.log(`Total indexes: ${Object.keys(finalGroups).length}`);

} catch (error) {
  console.error("❌ Error fixing indexes:", error.message);
  process.exit(1);
} finally {
  await sequelize.close();
}
