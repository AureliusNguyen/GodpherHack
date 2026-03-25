#!/usr/bin/env npx tsx
/**
 * Bulk upsert writeup .txt files to the Pinecone Hub RAG database.
 * Only upserts NEW files (tracks upserted IDs in .upserted.json).
 *
 * Folder structure determines category:
 *   writeups/
 *     rev/        ← category = "rev"
 *       baby-rev.txt
 *     pwn/        ← category = "pwn"
 *       bof.txt
 *     crypto/     ← category = "crypto"
 *     web/        ← category = "web"
 *     forensics/  ← category = "forensics"
 *     misc/       ← category = "misc" (also default for root-level files)
 *
 * Usage:
 *   npx tsx scripts/upsert-writeups.ts <folder>
 *   npx tsx scripts/upsert-writeups.ts ./writeups --dry-run
 *   npx tsx scripts/upsert-writeups.ts ./writeups --namespace my-team
 *   npx tsx scripts/upsert-writeups.ts ./writeups --force   (re-upsert all)
 *
 * Env:
 *   PINECONE_API_KEY       — required
 *   PINECONE_INDEX_NAME    — defaults to "ctf-writeups"
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename, extname, relative } from "node:path";
import { Pinecone } from "@pinecone-database/pinecone";

type Category = "pwn" | "rev" | "crypto" | "web" | "forensics" | "osint" | "misc" | "hardware";

const VALID_CATEGORIES = new Set<string>([
  "pwn", "rev", "crypto", "web", "forensics", "osint", "misc", "hardware", "mobile",
]);

function makeId(content: string, name: string): string {
  return createHash("sha256").update(`${content}|${name}`).digest("hex").slice(0, 24);
}

interface WriteupFile {
  path: string;
  name: string;
  category: Category;
  content: string;
  id: string;
}

/** Walk folder, collecting .txt files. Subfolder name = category. */
function collectWriteups(rootDir: string): WriteupFile[] {
  const writeups: WriteupFile[] = [];

  function walk(dir: string, parentCategory: Category) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const folderName = entry.name.toLowerCase();
        const category = VALID_CATEGORIES.has(folderName)
          ? (folderName as Category)
          : parentCategory;
        walk(fullPath, category);
      } else if (extname(entry.name).toLowerCase() === ".txt") {
        const content = readFileSync(fullPath, "utf-8").trim();
        if (!content) continue;
        const name = basename(entry.name, extname(entry.name));
        writeups.push({
          path: fullPath,
          name,
          category: parentCategory,
          content,
          id: makeId(content, name),
        });
      }
    }
  }

  walk(rootDir, "misc");
  return writeups;
}

// --- Tracking: only upsert new files ---

const TRACKER_FILE = ".upserted.json";

function loadTracker(folder: string): Set<string> {
  const path = join(folder, TRACKER_FILE);
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return new Set(data.ids ?? []);
  } catch {
    return new Set();
  }
}

function saveTracker(folder: string, ids: Set<string>): void {
  const path = join(folder, TRACKER_FILE);
  writeFileSync(path, JSON.stringify({ ids: [...ids] }, null, 2), "utf-8");
}

// --- CLI ---

function parseArgs() {
  const args = process.argv.slice(2);
  let folder = "";
  let namespace = "writeups";
  let dryRun = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--namespace" && args[i + 1]) {
      namespace = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--force") {
      force = true;
    } else if (!args[i].startsWith("-")) {
      folder = args[i];
    }
  }

  if (!folder) {
    console.error("Usage: npx tsx scripts/upsert-writeups.ts <folder> [--namespace <ns>] [--dry-run] [--force]");
    process.exit(1);
  }

  return { folder, namespace, dryRun, force };
}

async function main() {
  const { folder, namespace, dryRun, force } = parseArgs();

  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey && !dryRun) {
    console.error("Error: PINECONE_API_KEY not set");
    process.exit(1);
  }

  const indexName = process.env.PINECONE_INDEX_NAME ?? "ctf-writeups";

  // Collect all writeups
  const allWriteups = collectWriteups(folder);
  if (allWriteups.length === 0) {
    console.log(`No .txt files found in ${folder}`);
    return;
  }

  // Filter to new-only (unless --force)
  const tracker = force ? new Set<string>() : loadTracker(folder);
  const newWriteups = allWriteups.filter((wu) => !tracker.has(wu.id));

  console.log(`Found ${allWriteups.length} writeup(s), ${newWriteups.length} new\n`);

  if (newWriteups.length === 0) {
    console.log("Nothing to upsert — all files already tracked.");
    console.log("Use --force to re-upsert everything.");
    return;
  }

  // Build records
  const records: Record<string, unknown>[] = [];
  for (const wu of newWriteups) {
    const relPath = relative(folder, wu.path);
    const sizeKb = (statSync(wu.path).size / 1024).toFixed(1);

    records.push({
      _id: wu.id,
      writeup_text: wu.content,
      challengeName: wu.name,
      category: wu.category,
      title: wu.name,
      keywords: "",
      tools: "",
      summary: wu.content.slice(0, 200),
      keyInsights: "",
      createdAt: new Date().toISOString(),
    });

    console.log(`  ${relPath} → ${wu.category} (${sizeKb}K, id: ${wu.id.slice(0, 8)}...)`);
  }

  if (dryRun) {
    console.log(`\n[dry-run] Would upsert ${records.length} record(s) to ${indexName}/${namespace}`);
    return;
  }

  // Upsert to Pinecone
  const pc = new Pinecone({ apiKey: apiKey! });
  const index = pc.index(indexName);
  const ns = index.namespace(namespace);

  const BATCH_SIZE = 100;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await ns.upsertRecords({ records: batch as any });
    console.log(`  upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(records.length / BATCH_SIZE)}`);
  }

  // Update tracker with all known IDs (new + previously tracked)
  for (const wu of allWriteups) tracker.add(wu.id);
  saveTracker(folder, tracker);

  console.log(`\nDone! Upserted ${records.length} new writeup(s) to ${indexName}/${namespace}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
