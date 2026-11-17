import { describe, expect, it } from 'vitest'
import { stripCppComments, withLeetCodePrelude } from '../electron/services/compile-check'

describe('LeetCode-style compile environment', () => {
  it('adds headers and ListNode when the definition is only in a comment', () => {
    const src = '/**\n * struct ListNode {\n *   int val; ListNode *next;\n * };\n */\nclass Solution { public: ListNode* f(ListNode* h) { vector<int> v; return h; } };'
    const out = withLeetCodePrelude(src)
    expect(out.startsWith('#include <bits/stdc++.h>')).toBe(true)
    expect(out).toContain('struct ListNode { int val;')
    expect(out).not.toContain('struct TreeNode {')
  })
  it('leaves code alone when it defines its own types and headers', () => {
    const src = '#include <vector>\nstruct TreeNode { int val; TreeNode *left, *right; };\nclass Solution { public: int f(TreeNode* r) { return 0; } };'
    expect(withLeetCodePrelude(src)).toBe(src)
  })
  it('does not touch non-LeetCode programs', () => {
    const src = 'int main() { return 0; }'
    expect(withLeetCodePrelude(src)).toBe(src)
  })
  it('strips block and line comments', () => {
    expect(stripCppComments('a /* int main() { */ b // c\nd').replace(/\s+/g, ' ')).toBe('a b d')
  })
})
