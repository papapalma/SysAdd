
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
import { Sequelize } from "sequelize";

const isProd = process.env.NODE_ENV === "production";

const parseBool = (value) => String(value || "").toLowerCase() === "true";
const parsePort = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// Load DB configuration from environment with sane defaults for local dev
const DB_NAME = process.env.DB_NAME || "appdev";
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD ?? "";
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = parsePort(process.env.DB_PORT, 3306);
const DB_SSL = parseBool(process.env.DB_SSL);
const DB_LOGGING = parseBool(process.env.DB_LOGGING);

// In production, fail fast if required secrets are missing
if (isProd) {
  const missing = ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"].filter(
    (key) => !process.env[key]
  );
  if (missing.length) {
    throw new Error(
      `Missing required database environment variables: ${missing.join(", ")}`
    );
  }
}

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: DB_PORT,
  dialect: "mysql",
  logging: DB_LOGGING ? console.log : false,
  dialectOptions: DB_SSL
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : {},
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

// Disable automatic timestamps globally to avoid altering legacy tables
sequelize.options.define = sequelize.options.define || {};
sequelize.options.define.timestamps = false;