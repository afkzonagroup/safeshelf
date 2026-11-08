// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** True if `name` is a plain file name we are willing to create. */
export function isSafeFileName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.includes('..');
}

/**
 * Create a directory (and parents) with mode 0700 and return its real path.
 * Refuses when the directory itself is a symlink, so a planted link (for
 * example one committed to a repository the GitHub Action checks) cannot send
 * the reports somewhere else.
 *
 * @throws Error when the directory is a symlink or not a directory.
 */
export async function ensureDir(dir: string): Promise<string> {
  const existing = await lstat(dir).catch(() => null);
  if (existing?.isSymbolicLink() === true) throw new Error(`Refusing to write into ${dir}: it is a symlink`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Refusing to write into ${dir}: not a plain directory`);
  return await realpath(dir);
}

/**
 * Create (if needed) a sub-directory with a plain name inside `parent` and
 * return its real path. Refuses when the sub-directory is a symlink, so files
 * written into it cannot be redirected elsewhere.
 *
 * @throws Error when the name is unsafe or the entry is a symlink or not a directory.
 */
export async function ensureSubdir(parent: string, name: string): Promise<string> {
  if (!isSafeFileName(name)) throw new Error(`Unsafe directory name: ${name}`);
  const realParent = await realpath(parent);
  const target = path.join(realParent, name);
  await mkdir(target, { mode: 0o700 }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Refusing to write into ${target}: not a plain directory`);
  return target;
}

/**
 * Write a file inside `dir`. The name must be a plain file name (no path
 * separators, no "..") and the file is opened with O_NOFOLLOW so an existing
 * symlink cannot redirect the write; an existing hard link is refused. Mode
 * 0600.
 *
 * @throws Error when the name is unsafe or the target is a symlink or hard link.
 */
export async function safeWriteFile(dir: string, name: string, data: string | Uint8Array): Promise<string> {
  if (!isSafeFileName(name)) throw new Error(`Unsafe file name: ${name}`);
  const realDir = await realpath(dir);
  const target = path.join(realDir, name);
  if (path.dirname(target) !== realDir) throw new Error(`Unsafe file name: ${name}`);
  // O_NOFOLLOW is undefined on Windows; there the symlink check is skipped.
  const noFollow = (constants as Partial<typeof constants>).O_NOFOLLOW ?? 0;
  const flags = constants.O_WRONLY | constants.O_CREAT | noFollow;
  const handle = await open(target, flags, 0o600);
  try {
    // A hard link to a file elsewhere would be overwritten in place; refuse it before truncating.
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > 1) throw new Error(`Refusing to write ${target}: not a plain file`);
    await handle.truncate(0);
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  return target;
}
