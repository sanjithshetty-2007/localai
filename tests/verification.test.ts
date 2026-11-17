import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCppTest } from '../electron/services/compile-check'
import { normalizeFinal } from '../electron/services/orchestrator'

const TEST_MAIN = `int main(){
  ListNode* h = new ListNode(1, new ListNode(2, new ListNode(3, new ListNode(4, new ListNode(5)))));
  Solution s; ListNode* r = s.reverseKGroup(h, 2);
  int expect[] = {2,1,4,3,5}; for (int x : expect) { assert(r && r->val == x); r = r->next; }
  printf("ALL TESTS PASSED\\n"); }`

describe('running code to test it', () => {
  it('catches the real LeetCode 25 bug from a failed run (hangs or crashes)', async () => {
    const buggy = fs.readFileSync(path.join(__dirname, 'fixtures', 'lc25-buggy.cpp'), 'utf8')
    const r = await runCppTest(buggy, TEST_MAIN, 5000)
    expect(r.ran).toBe(true)
    expect(r.ok).toBe(false)
  }, 60000)
  it('passes a correct solution', async () => {
    const good = `class Solution { public: ListNode* reverseKGroup(ListNode* head, int k){ ListNode d(0, head); ListNode* g=&d; while(true){ ListNode* kth=g; for(int i=0;i<k&&kth;i++) kth=kth->next; if(!kth) break;
      ListNode* nxt=kth->next; ListNode* prev=nxt; ListNode* cur=g->next; while(cur!=nxt){ ListNode* t=cur->next; cur->next=prev; prev=cur; cur=t; } ListNode* first=g->next; g->next=kth; g=first; } return d.next; } };`
    const r = await runCppTest(good, TEST_MAIN, 5000)
    expect(r).toMatchObject({ ran: true, ok: true })
    expect(r.output).toContain('ALL TESTS PASSED')
  }, 60000)
})

describe('final answer comparison', () => {
  it('ignores spacing, commas and markdown but keeps operators', () => {
    expect(normalizeFinal('`A B C D ^ E - F G H * + ^ * + I -`')).toBe(normalizeFinal('ABCD^E-FGH*+^*+I-'))
    expect(normalizeFinal('30, 20, 10, 25, 40, 50')).toBe(normalizeFinal('30 20 10 25 40 50'))
    expect(normalizeFinal('ABCDE^-FGH*+^*+I-')).not.toBe(normalizeFinal('ABCD^E-FGH*+^*+I-'))
    expect(normalizeFinal('**15**')).toBe('15')
  })
})

describe('crash descriptions', () => {
  it('explains Windows crash codes', async () => {
    const { describeExit } = await import('../electron/services/compile-check')
    expect(describeExit(3221225477)).toMatch(/invalid memory access/)
    expect(describeExit(3221226505)).toMatch(/assert/)
    expect(describeExit(7)).toBe('exited with code 7')
  })
})
