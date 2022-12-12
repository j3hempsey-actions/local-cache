import * as core from "@actions/core";
import { exec, PromiseWithChild } from "child_process";
import fg from "fast-glob";
import filenamify from "filenamify";
import { basename, dirname, join } from "path";
import prettyBytes from "pretty-bytes";
import { promisify } from "util";

const execAsync = promisify(exec);

export class ReserveCacheError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReserveCacheError";
        Object.setPrototypeOf(this, ReserveCacheError.prototype);
    }
}

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ValidationError";
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}

function checkPaths(paths: string[]): void {
    if (!paths || paths.length === 0) {
        throw new ValidationError(
            `Path Validation Error: At least one directory or file path is required`
        );
    }
}

function checkKey(key: string): void {
    if (key.length > 255) {
        throw new ValidationError(
            `Key Validation Error: ${key} cannot be larger than 255 characters.`
        );
    }
    const regex = /^[^,]*$/;
    if (!regex.test(key)) {
        throw new ValidationError(
            `Key Validation Error: ${key} cannot contain commas.`
        );
    }
}

async function streamOutputUntilResolved(
    promise: PromiseWithChild<unknown>
): Promise<unknown> {
    const { child } = promise;
    const { stdout, stderr } = child;

    if (stdout) {
        stdout.on("data", data => {
            core.info(data.trim());
        });
    }

    if (stderr) {
        stderr.on("data", data => {
            if (!data) {
                return;
            }
            core.warning(data.trim());
        });
    }

    return promise;
}

function filterCacheFiles(
    filenameMatchers,
    cacheFiles: fg.Entry[]
): { key: string | null; potentialCaches: fg.Entry[] } {
    const potentialCaches: fg.Entry[] = [];
    for (const filenameMatcher of filenameMatchers) {
        for (const cacheFile of cacheFiles) {
            if (cacheFile.name.indexOf(filenameMatcher) !== -1) {
                potentialCaches.push(cacheFile);
            }
        }
        if (potentialCaches.length) {
            return { key: filenameMatcher, potentialCaches };
        }
    }
    return { key: null, potentialCaches };
}

function locateCacheFile(
    filenameMatchers,
    cacheFiles: fg.Entry[]
): { key: string; cacheFile: fg.Entry } | null {
    const { key, potentialCaches } = filterCacheFiles(
        filenameMatchers,
        cacheFiles
    );

    if (!potentialCaches.length || !key) {
        return null;
    }

    const latestCacheFile = potentialCaches
        .sort((a, b) => {
            const mtimeA = a.stats?.mtimeMs || 0;
            const mtimeB = b.stats?.mtimeMs || 0;

            return mtimeA > mtimeB ? 1 : mtimeB > mtimeA ? -1 : 0;
        })
        .pop();

    // console.log({ potentialCaches, latestCacheFile });

    if (!latestCacheFile) {
        return null;
    }

    return { key, cacheFile: latestCacheFile };
}

function getCacheDirPath(): string {
    return join(
        process.env.CACHE_DIR || `/media/cache/`,
        process.env.GITHUB_REPOSITORY || ""
    );
}

/**
 * Restores cache from keys
 *
 * @param paths a list of file paths to restore from the cache
 * @param primaryKey an explicit key for restoring the cache
 * @param restoreKeys an optional ordered list of keys to use for restoring the cache if no cache hit occurred for key
 * @returns string returns the key for the cache hit, otherwise returns undefined
 */
export async function restoreCache(
    paths: string[],
    primaryKey: string,
    restoreKeys?: string[]
): Promise<string | undefined> {
    checkKey(primaryKey);
    checkPaths(paths);
    const path = paths[0];

    const cacheDir = getCacheDirPath();

    // 1. check if we find any dir that matches our keys from restoreKeys
    const filenameMatchers = (
        Array.isArray(restoreKeys) && restoreKeys.length
            ? [primaryKey, ...restoreKeys]
            : [primaryKey]
    ).map(key => filenamify(key));
    const patterns = filenameMatchers.map(matcher => `${matcher}*`);
    const cacheFiles: fg.Entry[] = await fg(patterns, {
        cwd: cacheDir,
        objectMode: true,
        onlyFiles: true,
        stats: true,
        unique: true
    });

    // console.log(JSON.stringify({ patterns, cacheFiles }, null, 2));

    const result = locateCacheFile(filenameMatchers, cacheFiles);

    if (!result) {
        return undefined;
    }

    const { key, cacheFile } = result;

    // Restore files from archive
    const cachePath = join(cacheDir, cacheFile.path);
    const baseDir = dirname(path);
    const cmd = `lz4 -d -v -c ${cachePath} 2>/dev/null | tar xf - -C ${baseDir}`;

    core.info(
        [
            `Restoring cache: ${cacheFile.name}`,
            `Created: ${cacheFile.stats?.mtime}`,
            `Size: ${prettyBytes(cacheFile.stats?.size || 0)}`
        ].join("\n")
    );

    const createCacheDirPromise = execAsync(cmd);

    await streamOutputUntilResolved(createCacheDirPromise);

    return key;
}

/**
 * Saves a list of files with the specified key
 *
 * @param paths a list of file paths to be cached
 * @param key an explicit key for restoring the cache
 * @returns number returns cacheId if the cache was saved successfully and throws an error if save fails
 */
export async function saveCache(paths: string[], key: string): Promise<number> {
    checkPaths(paths);
    checkKey(key);

    // @todo for now we only support a single path.
    const path = paths[0];

    const cacheDir = getCacheDirPath();
    const cacheName = `${filenamify(key)}.tar.lz4`;
    const cachePath = join(cacheDir, cacheName);
    const baseDir = dirname(path);
    const folderName = basename(path);

    // Ensure cache dir exists
    const mkdirPromise = execAsync(`mkdir -p ${cacheDir}`);
    await streamOutputUntilResolved(mkdirPromise);

    const cmd = `tar cf - -C ${baseDir} ${folderName} | lz4 -v > ${cachePath} 2>/dev/null`;

    core.info(`Save cache: ${cacheName}`);
    // console.log({ cacheDir, cacheName, cachePath, cmd });

    const createCacheDirPromise = execAsync(cmd);

    await streamOutputUntilResolved(createCacheDirPromise);

    return 420;
}
