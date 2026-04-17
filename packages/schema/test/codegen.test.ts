import { describe, expect, it } from "vitest";
import { CodeGen, Scope, pathJoinExpr, quoteString, rawExpr } from "../src/codegen/index.js";

describe("CodeGen", () => {
  it("emits lines with two-space indentation inside blocks", () => {
    const gen = new CodeGen();
    gen.line("const x = 1;");
    gen.if("x > 0", (g) => g.line("return true;"));
    const src = gen.toString();
    expect(src).toBe(["const x = 1;", "if (x > 0) {", "  return true;", "}"].join("\n"));
  });

  it("emits if/else as a single construct", () => {
    const gen = new CodeGen();
    gen.if(
      "x > 0",
      (g) => g.line("pos();"),
      (g) => g.line("neg();"),
    );
    const src = gen.toString();
    expect(src).toBe(["if (x > 0) {", "  pos();", "} else {", "  neg();", "}"].join("\n"));
  });

  it("produces valid JavaScript that eval survives", () => {
    const gen = new CodeGen();
    gen.const("x", "1 + 2");
    gen.line("return x;");
    const body = gen.toString();
    const fn = new Function(body);
    expect(fn()).toBe(3);
  });

  it("emits a for-of loop body", () => {
    const gen = new CodeGen();
    gen.let("total", "0");
    gen.forOf("v", "[1, 2, 3]", (g) => g.line("total += v;"));
    gen.line("return total;");
    const fn = new Function(gen.toString());
    expect(fn()).toBe(6);
  });
});

describe("Scope", () => {
  it("hands out unique names per prefix", () => {
    const s = new Scope();
    expect(s.name("i")).toBe("i0");
    expect(s.name("i")).toBe("i1");
    expect(s.name("j")).toBe("j0");
  });
});

describe("quoteString", () => {
  it("escapes quotes, newlines, and backslashes", () => {
    expect(quoteString('a"b\n\\c')).toBe('"a\\"b\\n\\\\c"');
  });
});

describe("pathJoinExpr", () => {
  it("returns the base expression when no segments are appended", () => {
    expect(pathJoinExpr("path", [])).toBe("path");
  });

  it("appends quoted strings and numbers", () => {
    expect(pathJoinExpr("path", ["foo", 3])).toBe('[...path, "foo", 3]');
  });

  it("embeds raw expressions verbatim", () => {
    expect(pathJoinExpr("path", ["users", rawExpr("i0")])).toBe('[...path, "users", i0]');
  });
});
