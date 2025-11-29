import { describe, it, expect, vi } from "vitest";
import {
    stableHashIgnoringVolatile,
    extractLocation,
    convertFileUrlToUrl,
    generateMermaid,
} from "../src/index.js";

describe("stableHashIgnoringVolatile", () => {
    it("should produce the same hash for objects differing only in volatile fields", () => {
        const obj1 = {
            message: "test error",
            name: "Error",
            timestamp: "2024-01-01T00:00:00.000Z",
            process: { uptime: 100, memoryUsage: { rss: 1000 }, cwd: "/home/test" },
        };
        const obj2 = {
            message: "test error",
            name: "Error",
            timestamp: "2025-12-31T23:59:59.999Z",
            process: { uptime: 9999, memoryUsage: { rss: 9999 }, cwd: "/different/path" },
        };

        expect(stableHashIgnoringVolatile(obj1)).toBe(stableHashIgnoringVolatile(obj2));
    });

    it("should produce different hashes for objects differing in non-volatile fields", () => {
        const obj1 = { message: "error 1", name: "Error" };
        const obj2 = { message: "error 2", name: "Error" };

        expect(stableHashIgnoringVolatile(obj1)).not.toBe(stableHashIgnoringVolatile(obj2));
    });

    it("should handle nested objects consistently", () => {
        const obj1 = { a: { b: { c: 1 } } };
        const obj2 = { a: { b: { c: 1 } } };

        expect(stableHashIgnoringVolatile(obj1)).toBe(stableHashIgnoringVolatile(obj2));
    });

    it("should handle arrays consistently", () => {
        const obj1 = { items: [1, 2, 3] };
        const obj2 = { items: [1, 2, 3] };

        expect(stableHashIgnoringVolatile(obj1)).toBe(stableHashIgnoringVolatile(obj2));
    });
});

describe("extractLocation", () => {
    it("should extract location from a standard Node.js stack trace", () => {
        const stack = `Error: test
at myFunction (/home/user/project/src/index.js:42:15)
at Module._compile (node:internal/modules/cjs/loader:1234:14)`;

        const result = extractLocation(stack);

        expect(result).toEqual({
            file: "/home/user/project/src/index.js",
            line: "42",
            column: "15",
            frameText: "at myFunction (/home/user/project/src/index.js:42:15)",
        });
    });

    it("should extract location from a file:// URL stack trace", () => {
        const stack = `Error: test
    at file:///home/user/project/src/index.js:10:5`;

        const result = extractLocation(stack);

        expect(result).toEqual({
            file: "file:///home/user/project/src/index.js",
            line: "10",
            column: "5",
            frameText: "at file:///home/user/project/src/index.js:10:5",
        });
    });

    it("should skip node:internal frames", () => {
        const stack = `Error: test
at Module._compile (node:internal/modules/cjs/loader:1234:14)
at myFunction (/home/user/project/src/index.js:42:15)`;

        const result = extractLocation(stack);

        expect(result?.file).toBe("/home/user/project/src/index.js");
    });

    it("should return null for empty or invalid input", () => {
        expect(extractLocation(null)).toBeNull();
        expect(extractLocation(undefined)).toBeNull();
        expect(extractLocation("")).toBeNull();
    });
});

describe("convertFileUrlToUrl", () => {
    it("should convert a file path to a GitHub blob URL", () => {
        const result = convertFileUrlToUrl(
            "/home/user/project/src/index.js",
            "42",
            "15",
            "owner",
            "repo",
            "abc123",
            "/home/user/project"
        );

        expect(result).toBe("https://github.com/owner/repo/blob/abc123/src/index.js#L42");
    });

    it("should handle file:// URLs", () => {
        const result = convertFileUrlToUrl(
            "file:///home/user/project/src/index.js",
            "10",
            "5",
            "owner",
            "repo",
            "def456",
            "/home/user/project"
        );

        expect(result).toBe("https://github.com/owner/repo/blob/def456/src/index.js#L10");
    });
});

describe("generateMermaid", () => {
    it("should generate a valid Mermaid class diagram", () => {
        const report = {
            message: "Test error",
            name: "Error",
            timestamp: "2024-01-01T00:00:00.000Z",
            type: "Error",
            process: {
                uptime: 100,
                cwd: "/home/user/project",
                memoryUsage: { rss: 1000, heapTotal: 2000, heapUsed: 1500 },
            },
        };

        const result = generateMermaid(report, "abc123", null);

        expect(result).toContain("```mermaid");
        expect(result).toContain("classDiagram");
        expect(result).toContain("class ErrorReport");
        expect(result).toContain("+message: \"Test error\"");
        expect(result).toContain("+commitHash: \"abc123\"");
        expect(result).toContain("class ProcessInfo");
        expect(result).toContain("class MemoryUsage");
        expect(result).toContain("ErrorReport *-- ProcessInfo");
        expect(result).toContain("```");
    });

    it("should include location with clickable link when provided", () => {
        const report = {
            message: "Test error",
            name: "Error",
            timestamp: "2024-01-01T00:00:00.000Z",
            type: "Error",
            process: {
                uptime: 100,
                cwd: "/home/user/project",
                memoryUsage: { rss: 1000, heapTotal: 2000, heapUsed: 1500 },
            },
            reportLocation: {
                file: "/home/user/project/src/index.js",
                line: "42",
                column: "15",
            },
        };
        const locationUrl = "https://github.com/owner/repo/blob/abc123/src/index.js#L42";

        const result = generateMermaid(report, "abc123", locationUrl);

        expect(result).toContain("class Location");
        expect(result).toContain("+line: \"42\"");
        expect(result).toContain("+column: \"15\"");
        expect(result).toContain("ErrorReport *-- Location");
        expect(result).toContain(`click Location href "${locationUrl}" "Go to code"`);
    });

    it("should escape special characters in message", () => {
        const report = {
            message: 'Error with "quotes" and\nnewlines',
            name: "Error",
            timestamp: "2024-01-01T00:00:00.000Z",
            type: "Error",
            process: {
                uptime: 100,
                cwd: "/home/user/project",
                memoryUsage: { rss: 1000, heapTotal: 2000, heapUsed: 1500 },
            },
        };

        const result = generateMermaid(report, "abc123", null);

        expect(result).not.toContain('"quotes"');
        expect(result).toContain("'quotes'");
        expect(result).toContain(" newlines");
    });

    it("should handle null/undefined values gracefully", () => {
        const report = {
            message: null,
            name: undefined,
            timestamp: "2024-01-01T00:00:00.000Z",
            type: "Error",
            process: {
                uptime: 100,
                cwd: "/home/user/project",
                memoryUsage: { rss: 1000, heapTotal: 2000, heapUsed: 1500 },
            },
        };

        const result = generateMermaid(report, "abc123", null);

        expect(result).toContain("+message: \"N/A\"");
        expect(result).toContain("+name: \"N/A\"");
    });
});
