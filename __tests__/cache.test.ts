import { exec } from "child_process";
import fs from "fs";
import { resolve } from "path";
import { promisify } from "util";

import * as cache from "../src/cache";

const execAsync = promisify(exec);

const FIXTURES_DIR = resolve(__dirname, "__fixtures__");
const FIXTURES_BACKUP_DIR = resolve(__dirname, "__fixtures-backup__");
const CACHE_DIR = (process.env.CACHE_DIR = resolve(__dirname, "__tmp__"));
const GITHUB_REPOSITORY = (process.env.GITHUB_REPOSITORY = "integration-test");

describe("save and restore files", () => {
    beforeEach(async () => {
        await fs.promises.rmdir(CACHE_DIR, { recursive: true });
        await fs.promises.rmdir(FIXTURES_BACKUP_DIR, { recursive: true });
        await execAsync(`git checkout ${resolve(FIXTURES_DIR)}`);
    });
    test("creates archive file", async () => {
        await cache.saveCache([FIXTURES_DIR], "save-test");
        await fs.promises.access(
            resolve(CACHE_DIR, GITHUB_REPOSITORY, "save-test.tar.lz4"),
            fs.constants.R_OK | fs.constants.W_OK
        );
    });
    test("restores single archive file", async () => {
        // Save cache
        await cache.saveCache([FIXTURES_DIR], "restore-test");

        // Create backup dir from fixtrues for comparision
        await fs.promises.rename(FIXTURES_DIR, FIXTURES_BACKUP_DIR);

        // Delete fixtures dir and restore
        await fs.promises.rmdir(FIXTURES_DIR, { recursive: true });
        await cache.restoreCache([FIXTURES_DIR], "restore-test");

        // Assert that backup dir and restored dir have the same content
        await execAsync(`diff -Naur ${FIXTURES_DIR} ${FIXTURES_BACKUP_DIR}`);
    });

    test("restore latest archive file", async () => {
        const filePath = resolve(FIXTURES_DIR, "helloWorld.txt");

        // Save cache with fixture file
        await cache.saveCache([FIXTURES_DIR], "latest-archive-test-1");

        // Delete fixture file and save newer cache
        await fs.promises.unlink(filePath);
        await cache.saveCache([FIXTURES_DIR], "latest-archive-test-2");

        // Delete fixtures dir and restore
        await fs.promises.rmdir(FIXTURES_DIR, {
            recursive: true
        });
        await cache.restoreCache([FIXTURES_DIR], "latest-archive-test");

        // Expect the cache without fixture file to be restored
        return expect(
            fs.promises.access(filePath, fs.constants.R_OK | fs.constants.W_OK)
        ).rejects.toMatchObject({
            code: "ENOENT",
            path: /helloWorld\.txt$/
        });
    });
    test("restore from fallback key", async () => {
        // Save cache
        await cache.saveCache([FIXTURES_DIR], "fallback-test");

        // Create backup dir and remove fixtures
        await fs.promises.rename(FIXTURES_DIR, FIXTURES_BACKUP_DIR);
        await fs.promises.rmdir(FIXTURES_DIR, { recursive: true });

        // Restore with non-existing primary key, but a matching fallback key
        await cache.restoreCache([FIXTURES_DIR], "fallback-test-doesnt-exist", [
            "fallback-test"
        ]);

        // Assert that backup dir and restored dir have the same content
        await execAsync(`diff -Naur ${FIXTURES_DIR} ${FIXTURES_BACKUP_DIR}`);
    });
});
