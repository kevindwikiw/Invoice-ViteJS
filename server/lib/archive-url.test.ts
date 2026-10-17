import { expect, test } from "bun:test";
import { isAllowedArchivePublicUrl } from "./archive-url";

test("archive public URLs require HTTPS except for local loopback", () => {
    for (const url of ["https://archive.example.test", "http://localhost:8089", "http://127.0.0.1:8089", "http://127.0.0.2:8089", "http://[::1]:8089"]) {
        expect(isAllowedArchivePublicUrl(url)).toBe(true);
    }
    for (const url of ["http://archive.example.test", "https://", "ftp://localhost:8089", "not a URL"]) {
        expect(isAllowedArchivePublicUrl(url)).toBe(false);
    }
});
