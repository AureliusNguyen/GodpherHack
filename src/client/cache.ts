import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = join(homedir(), ".godpherhack", "cache");

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class FileCache {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? CACHE_DIR;
  }

  async get<T>(key: string): Promise<T | null> {
    const path = this.keyToPath(key);
    try {
      const raw = await readFile(path, "utf-8");
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        await unlink(path).catch(() => {});
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, data: T, ttlMs: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
    const dest = this.keyToPath(key);
    const tmp = dest + "." + randomBytes(4).toString("hex") + ".tmp";
    await writeFile(tmp, JSON.stringify(entry), "utf-8");
    await rename(tmp, dest);
  }

  private keyToPath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 24);
    return join(this.dir, `${hash}.json`);
  }
}

export function cacheKey(...parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex");
}
