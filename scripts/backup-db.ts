#!/usr/bin/env bun
/**
 * Database Backup CLI Tool
 *
 * Performs a consistent PostgreSQL backup to a timestamped SQL file.
 *
 * Usage:
 *   DATABASE_URL="..." bun run scripts/backup-db.ts [output-file]
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl || databaseUrl.trim() === "") {
    console.error("Error: DATABASE_URL is required in environment.");
    process.exit(1);
  }

  const url = new URL(databaseUrl);
  const outputFile =
    process.argv[2] ??
    `backups/backup-${url.pathname.replace(/^\//, "")}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;

  mkdirSync(dirname(outputFile), { recursive: true });

  console.log("----------------------------------------------------------------");
  console.log("             Creator Outdoor - Database Backup                  ");
  console.log("----------------------------------------------------------------");
  console.log(`Database:    ${url.pathname.replace(/^\//, "")}`);
  console.log(`Host:        ${url.hostname}:${url.port || "5432"}`);
  console.log(`Output File: ${outputFile}`);

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
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "-f",
    outputFile,
  ];

  console.log("\n1. Running pg_dump...");
  const result = spawnSync("pg_dump", args, { env, stdio: "inherit" });

  if (result.status !== 0) {
    console.error(`✖ pg_dump failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  console.log(`✔ Backup completed successfully! Saved to: ${outputFile}`);
  console.log("----------------------------------------------------------------\n");
}

main();
