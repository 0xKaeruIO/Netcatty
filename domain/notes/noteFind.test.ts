import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import test from "node:test";

import {
  advanceNoteFindIndex,
  collectStringMatches,
  collectVisibleTextNodes,
  indexOfMatchContainingCaret,
  isNoteFindCloseKey,
  isNoteFindNextKey,
  isNoteFindOpenKey,
  isNoteFindPreviousKey,
  mapStringMatchesToDom,
  splitTextForFindHighlights,
} from "./noteFind.ts";

test("collectStringMatches finds case-insensitive non-overlapping ranges", () => {
  assert.deepEqual(collectStringMatches("Hello hello HELLO", "hello"), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
    { start: 12, end: 17 },
  ]);
  assert.deepEqual(collectStringMatches("cat > run1.sh <<EOF", "<<EOF"), [
    { start: 14, end: 19 },
  ]);
  assert.deepEqual(collectStringMatches("nope", "yes"), []);
  assert.deepEqual(collectStringMatches("abc", ""), []);
});

test("advanceNoteFindIndex wraps around the match list", () => {
  assert.equal(advanceNoteFindIndex(-1, 3, 1), 0);
  assert.equal(advanceNoteFindIndex(0, 3, 1), 1);
  assert.equal(advanceNoteFindIndex(2, 3, 1), 0);
  assert.equal(advanceNoteFindIndex(0, 3, -1), 2);
  assert.equal(advanceNoteFindIndex(0, 0, 1), -1);
});

test("indexOfMatchContainingCaret prefers the match at the caret", () => {
  const matches = collectStringMatches("one two one", "one");
  assert.equal(indexOfMatchContainingCaret(matches, 0), 0);
  assert.equal(indexOfMatchContainingCaret(matches, 8), 1);
  assert.equal(indexOfMatchContainingCaret(matches, 4), 1);
});

test("splitTextForFindHighlights marks the current match separately", () => {
  const text = "abXab";
  const matches = collectStringMatches(text, "ab");
  assert.deepEqual(splitTextForFindHighlights(text, matches, 1), [
    { text: "ab", kind: "match" },
    { text: "X", kind: "plain" },
    { text: "ab", kind: "current" },
  ]);
});

test("note find hotkeys match editor conventions", () => {
  assert.equal(isNoteFindOpenKey({ key: "f", metaKey: false, ctrlKey: true, altKey: false }), true);
  assert.equal(isNoteFindOpenKey({ key: "F", metaKey: true, ctrlKey: false, altKey: false }), true);
  assert.equal(isNoteFindOpenKey({ key: "f", metaKey: false, ctrlKey: true, altKey: true }), false);
  assert.equal(isNoteFindNextKey({ key: "F3", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }), true);
  assert.equal(isNoteFindPreviousKey({ key: "F3", metaKey: false, ctrlKey: false, altKey: false, shiftKey: true }), true);
  assert.equal(isNoteFindNextKey({ key: "g", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }), true);
  assert.equal(isNoteFindPreviousKey({ key: "g", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true }), true);
  assert.equal(isNoteFindCloseKey({ key: "Escape" }), true);
});

test("mapStringMatchesToDom maps concatenated text nodes including code blocks", () => {
  const dom = new JSDOM("<!doctype html><p>alpha <strong>beta</strong> gamma</p>");
  const root = dom.window.document.querySelector("p");
  assert.ok(root);
  const nodes = collectVisibleTextNodes(root);
  const matches = collectStringMatches(nodes.map((node) => node.nodeValue ?? "").join(""), "beta");
  const mapped = mapStringMatchesToDom(nodes, matches);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].start.node.nodeValue, "beta");
  assert.equal(mapped[0].start.offset, 0);
  assert.equal(mapped[0].end.offset, 4);
  dom.window.close();
});
