import { describe, expect, it } from "vitest";
import { createRedactor, secretValuesOf } from "./redaction.js";

describe("secretValuesOf", () => {
  it("keeps values of variables whose name matches KEY, TOKEN, SECRET or PASSWORD and is at least 8 characters, longest first", () => {
    const secrets = secretValuesOf({ ANTHROPIC_API_KEY: "sk-ant-123456", gh_token: "ghp_abcdefgh", DB_PASSWORD: "hunter22", HOME: "/Users/someone-long-value", SHORT_SECRET: "abc1234", EMPTY_KEY: undefined });

    expect(secrets).toEqual(["sk-ant-123456", "ghp_abcdefgh", "hunter22"]);
  });

  it("returns each distinct value once", () => {
    expect(secretValuesOf({ A_KEY: "same-value", B_TOKEN: "same-value" })).toEqual(["same-value"]);
  });
});

describe("createRedactor", () => {
  it("replaces every occurrence of a secret, including one nested in a longer secret", () => {
    const redactor = createRedactor(["abcdefgh", "abcdefgh-ijklmnop"]);

    expect(redactor.text("x abcdefgh-ijklmnop y abcdefgh z")).toBe("x [REDACTED] y [REDACTED] z");
  });

  it("replaces the JSON-escaped spelling of a secret inside a serialized string", () => {
    const redactor = createRedactor(['pa"ss\\word']);

    expect(redactor.text(JSON.stringify({ detail: 'got pa"ss\\word here' }))).toBe('{"detail":"got [REDACTED] here"}');
  });

  it("leaves text without secrets unchanged", () => {
    expect(createRedactor(["abcdefgh"]).text("nothing here")).toBe("nothing here");
  });
});
