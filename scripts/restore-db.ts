#!/usr/bin/env bun
/**
 * Database Restore CLI Tool
 *
 * Rehearses or executes a database restore from a backup SQL file.
 *
 * Usage:
 *   TARGET_DATABASE_URL="..." bun run scripts/restore-db.ts <backup-file.sql> [--confirm]
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

async function main() {
  const targetUrl = process.env["TARGET_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  const backupFile = process.argv[2];
  const isConfirmed = process.argv.includes("--confirm");

  if (!targetUrl || targetUrl.trim() === "") {
    console.error("Error: TARGET_DATABASE_URL (or DATABASE_URL) is required in environment.");
    process.exit(1);
  }

  if (!backupFile || backupFile.startsWith("--")) {
    console.error("Usage: bun run scripts/restore-db.ts <backup-file.sql> [--confirm]");
    process.exit(1);
  }

  if (!existsSync(backupFile)) {
    console.error(`Error: Backup file not found: ${backupFile}`);
    process.exit(1);
  }

  const url = new URL(targetUrl);

  console.log("----------------------------------------------------------------");
  console.log("             Creator Outdoor - Database Restore                 ");
  console.log("----------------------------------------------------------------");
  console.log(`Target Database: ${url.pathname.replace(/^\//, "")}`);
  console.log(`Host:            ${url.hostname}:${url.port || "5432"}`);
  console.log(`Backup File:     ${backupFile}`);

  if (!isConfirmed && process.env["NODE_ENV"] === "production") {
    console.error("Error: Restoring into a production environment requires the --confirm flag.");
    process.exit(1);
  }

  const env = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(url.password),
  };

  const args = [
    "-h",
    url.hostname,
    "-p",
    url.port || "5432",
    "-U",
    decodeURIComponent(url.username),
    "-d",
    url.pathname.replace(/^\//, ""),
    "-f",
    backupFile,
  ];

  console.log("\n1. Running psql to restore schema and data...");
  const result = spawnSync("psql", args, { env, stdio: "inherit" });

  if (result.status !== 0) {
    console.error(`✖ psql restore failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  console.log(`✔ Restore completed successfully into ${url.pathname.replace(/^\//, "")}!`);
  console.log("----------------------------------------------------------------\n");
}

main();
