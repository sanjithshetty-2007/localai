// DSA / LeetCode test suite with objective graders.
// Code problems: the answer's C++ is compiled with g++ and run against hidden tests.
// Exam problems: the exact expected answer is checked in the response.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const PRELUDE = `#include <bits/stdc++.h>
using namespace std;
`
const TREE = `struct TreeNode { int val; TreeNode *left; TreeNode *right; TreeNode() : val(0), left(nullptr), right(nullptr) {} TreeNode(int x) : val(x), left(nullptr), right(nullptr) {} TreeNode(int x, TreeNode *l, TreeNode *r) : val(x), left(l), right(r) {} };
`
const LIST = `struct ListNode { int val; ListNode *next; ListNode() : val(0), next(nullptr) {} ListNode(int x) : val(x), next(nullptr) {} ListNode(int x, ListNode *n) : val(x), next(n) {} };
`
const BUILD_TREE = `
static TreeNode* buildTree(const vector<string>& v) { // level order, "null" for missing
  if (v.empty() || v[0] == "null") return nullptr;
  TreeNode* root = new TreeNode(stoi(v[0])); queue<TreeNode*> q; q.push(root); size_t i = 1;
  while (!q.empty() && i < v.size()) { TreeNode* n = q.front(); q.pop();
    if (i < v.size() && v[i] != "null") { n->left = new TreeNode(stoi(v[i])); q.push(n->left); } i++;
    if (i < v.size() && v[i] != "null") { n->right = new TreeNode(stoi(v[i])); q.push(n->right); } i++; }
  return root; }
static TreeNode* findNode(TreeNode* r, int val) { if (!r) return nullptr; if (r->val == val) return r; TreeNode* a = findNode(r->left, val); return a ? a : findNode(r->right, val); }
`
const CHECK = `static int passed = 0, total = 0;
#define CHECK(cond) do { total++; if (cond) passed++; else printf("FAILED: %s\\n", #cond); } while (0)
`

export const PROBLEMS = [
  // ---------------- LeetCode (C++) ----------------
  {
    id: 'lc863', kind: 'code', fn: 'distanceK', needs: ['tree'],
    q: 'LeetCode 863 - All Nodes Distance K in Binary Tree. Given the root of a binary tree, the value of a target node target, and an integer k, return an array of the values of all nodes that have a distance k from the target node, in any order. Write the C++ solution as class Solution with method vector<int> distanceK(TreeNode* root, TreeNode* target, int k).',
    harness: `
int main(){
  TreeNode* r = buildTree({"3","5","1","6","2","0","8","null","null","7","4"});
  auto s = [&](int t, int k){ Solution sol; auto v = sol.distanceK(r, findNode(r,t), k); sort(v.begin(), v.end()); return v; };
  CHECK((s(5,2) == vector<int>{1,4,7})); CHECK((s(3,0) == vector<int>{3})); CHECK((s(7,3) == vector<int>{3,6}));
  CHECK((s(5,10) == vector<int>{})); CHECK((s(8,4) == vector<int>{2,6}));
  TreeNode* one = buildTree({"1"}); Solution s2; CHECK(s2.distanceK(one, one, 3).empty());
  printf("RESULT %d/%d\\n", passed, total); }`
  },
  {
    id: 'lc102', kind: 'code', fn: 'levelOrder', needs: ['tree'],
    q: 'LeetCode 102 - Binary Tree Level Order Traversal. Given the root of a binary tree, return the level order traversal of its nodes values (from left to right, level by level). Write the C++ solution as class Solution with method vector<vector<int>> levelOrder(TreeNode* root).',
    harness: `
int main(){ Solution s;
  CHECK((s.levelOrder(buildTree({"3","9","20","null","null","15","7"})) == vector<vector<int>>{{3},{9,20},{15,7}}));
  CHECK((s.levelOrder(buildTree({"1"})) == vector<vector<int>>{{1}}));
  CHECK(s.levelOrder(nullptr).empty());
  CHECK((s.levelOrder(buildTree({"1","2","3","4","null","null","5"})) == vector<vector<int>>{{1},{2,3},{4,5}}));
  printf("RESULT %d/%d\\n", passed, total); }`
  },
  {
    id: 'lc236', kind: 'code', fn: 'lowestCommonAncestor', needs: ['tree'],
    q: 'LeetCode 236 - Lowest Common Ancestor of a Binary Tree. Given a binary tree (not a BST) and two nodes p and q that both exist in the tree, return their lowest common ancestor (a node may be a descendant of itself). Write the C++ solution as class Solution with method TreeNode* lowestCommonAncestor(TreeNode* root, TreeNode* p, TreeNode* q).',
    harness: `
int main(){ TreeNode* r = buildTree({"3","5","1","6","2","0","8","null","null","7","4"}); Solution s;
  auto L = [&](int a, int b){ return s.lowestCommonAncestor(r, findNode(r,a), findNode(r,b))->val; };
  CHECK(L(5,1) == 3); CHECK(L(5,4) == 5); CHECK(L(7,4) == 2); CHECK(L(6,4) == 5); CHECK(L(0,8) == 1); CHECK(L(7,8) == 3);
  printf("RESULT %d/%d\\n", passed, total); }`
  },
  {
    id: 'lc207', kind: 'code', fn: 'canFinish', needs: [],
    q: 'LeetCode 207 - Course Schedule. There are numCourses courses labeled 0 to numCourses-1 and an array prerequisites where prerequisites[i] = [a, b] means you must take course b before course a. Return true if you can finish all courses, otherwise false. Write the C++ solution as class Solution with method bool canFinish(int numCourses, vector<vector<int>>& prerequisites).',
    harness: `
int main(){ Solution s;
  { vector<vector<int>> p{{1,0}}; CHECK(s.canFinish(2,p) == true); }
  { vector<vector<int>> p{{1,0},{0,1}}; CHECK(s.canFinish(2,p) == false); }
  { vector<vector<int>> p{}; CHECK(s.canFinish(3,p) == true); }
  { vector<vector<int>> p{{1,0},{2,1},{3,2},{1,3}}; CHECK(s.canFinish(4,p) == false); }
  { vector<vector<int>> p{{1,0},{2,0},{3,1},{3,2},{4,3}}; CHECK(s.canFinish(5,p) == true); }
  { vector<vector<int>> p{{0,0}}; CHECK(s.canFinish(1,p) == false); }
  printf("RESULT %d/%d\\n", passed, total); }`
  },
  {
    id: 'lc743', kind: 'code', fn: 'networkDelayTime', needs: [],
    q: 'LeetCode 743 - Network Delay Time. You are given a network of n nodes labeled 1 to n and times[i] = (u, v, w), a directed edge from u to v taking w time. A signal is sent from node k. Return the minimum time it takes for all n nodes to receive the signal, or -1 if impossible. Write the C++ solution as class Solution with method int networkDelayTime(vector<vector<int>>& times, int n, int k).',
    harness: `
int main(){ Solution s;
  { vector<vector<int>> t{{2,1,1},{2,3,1},{3,4,1}}; CHECK(s.networkDelayTime(t,4,2) == 2); }
  { vector<vector<int>> t{{1,2,1}}; CHECK(s.networkDelayTime(t,2,1) == 1); }
  { vector<vector<int>> t{{1,2,1}}; CHECK(s.networkDelayTime(t,2,2) == -1); }
  { vector<vector<int>> t{{1,2,4},{1,3,1},{3,2,1},{2,4,1},{3,4,5}}; CHECK(s.networkDelayTime(t,4,1) == 3); }
  { vector<vector<int>> t{}; CHECK(s.networkDelayTime(t,1,1) == 0); }
  printf("RESULT %d/%d\\n", passed, total); }`
  },
  {
    id: 'lc84', kind: 'code', fn: 'largestRectangleArea', needs: [],
    q: 'LeetCode 84 - Largest Rectangle in Histogram. Given an array of integers heights representing the histogram bar heights where each bar has width 1, return the area of the largest rectangle in the histogram. Write the C++ solution as class Solution with method int largestRectangleArea(vector<int>& heights).',
    harness: `
int main(){ Solution s;
  auto A = [&](vector<int> h){ return s.largestRectangleArea(h); };
  CHECK(A({2,1,5,6,2,3}) == 10); CHECK(A({2,4}) == 4); CHECK(A({1}) == 1); CHECK(A({0}) == 0);
  CHECK(A({1,1,1,1}) == 4); CHECK(A({6,2,5,4,5,1,6}) == 12); CHECK(A({5,4,3,2,1}) == 9);
  printf("RESULT %d/%d\\n", passed, total); }`
  },
  {
    id: 'lc239', kind: 'code', fn: 'maxSlidingWindow', needs: [],
    q: 'LeetCode 239 - Sliding Window Maximum. Given an integer array nums and a window size k that slides from left to right one position at a time, return the maximum of each window. Write the C++ solution as class Solution with method vector<int> maxSlidingWindow(vector<int>& nums, int k).',
    harness: `
int main(){ Solution s;
  auto M = [&](vector<int> v, int k){ return s.maxSlidingWindow(v, k); };
  CHECK((M({1,3,-1,-3,5,3,6,7},3) == vector<int>{3,3,5,5,6,7})); CHECK((M({1},1) == vector<int>{1}));
  CHECK((M({9,8,7,6},2) == vector<int>{9,8,7})); CHECK((M({1,2,3,4},4) == vector<int>{4})); CHECK((M({4,-2},2) == vector<int>{4}));
  printf("RESULT %d/%d\\n", passed, total); }`
  },
  {
    id: 'lc150', kind: 'code', fn: 'evalRPN', needs: [],
    q: 'LeetCode 150 - Evaluate Reverse Polish Notation. Evaluate an arithmetic expression given in Reverse Polish Notation as an array of string tokens using +, -, *, / where division truncates toward zero. Write the C++ solution as class Solution with method int evalRPN(vector<string>& tokens).',
    harness: `
int main(){ Solution s;
  auto E = [&](vector<string> t){ return s.evalRPN(t); };
  CHECK(E({"2","1","+","3","*"}) == 9); CHECK(E({"4","13","5","/","+"}) == 6);
  CHECK(E({"10","6","9","3","+","-11","*","/","*","17","+","5","+"}) == 22); CHECK(E({"-7","2","/"}) == -3); CHECK(E({"42"}) == 42);
  printf("RESULT %d/%d\\n", passed, total); }`
  },
  {
    id: 'lc25', kind: 'code', fn: 'reverseKGroup', needs: ['list'],
    q: 'LeetCode 25 - Reverse Nodes in k-Group. Given the head of a singly linked list, reverse the nodes k at a time and return the modified list; nodes left over at the end (fewer than k) stay in their original order. Do not change node values, only links. Write the C++ solution as class Solution with method ListNode* reverseKGroup(ListNode* head, int k).',
    harness: `
static ListNode* mk(vector<int> v){ ListNode d; ListNode* t=&d; for(int x: v){ t->next=new ListNode(x); t=t->next; } return d.next; }
static vector<int> out(ListNode* h){ vector<int> v; while(h){ v.push_back(h->val); h=h->next; } return v; }
int main(){ Solution s;
  CHECK((out(s.reverseKGroup(mk({1,2,3,4,5}),2)) == vector<int>{2,1,4,3,5}));
  CHECK((out(s.reverseKGroup(mk({1,2,3,4,5}),3)) == vector<int>{3,2,1,4,5}));
  CHECK((out(s.reverseKGroup(mk({1,2,3,4,5}),1)) == vector<int>{1,2,3,4,5}));
  CHECK((out(s.reverseKGroup(mk({1,2,3,4,5,6}),3)) == vector<int>{3,2,1,6,5,4}));
  CHECK((out(s.reverseKGroup(mk({1}),2)) == vector<int>{1}));
  printf("RESULT %d/%d\\n", passed, total); }`
  },

  // ---------------- Exam questions (exact answers) ----------------
  {
    id: 'fifo', kind: 'exact',
    q: 'Using FIFO page replacement with 3 page frames (initially empty), how many page faults occur for the reference string 7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1? Show the frame contents step by step and state the total number of page faults.',
    check: (a) => totalFaults(a) === 15,
    expect: '15 page faults'
  },
  {
    id: 'avl', kind: 'exact',
    q: 'Insert the keys 10, 20, 30, 40, 50, 25 in this order into an initially empty AVL tree. For each rotation say its type (LL, RR, LR, RL) and the node where the imbalance occurs, then give the preorder traversal of the final tree.',
    check: (a) => /30\D+20\D+10\D+25\D+40\D+50/.test(a.slice(-1500)) && rotationFor(a, 30, /\bRR\b|right[- ]right/i, 10) && rotationFor(a, 50, /\bRR\b|right[- ]right/i, 30) && rotationFor(a, 25, /\bRL\b|right[- ]left/i, 20),
    expect: 'RR at 10, RR at 30, RL at 20; preorder 30 20 10 25 40 50'
  },
  {
    id: 'postfix', kind: 'exact',
    q: 'Convert the infix expression A+B*(C^D-E)^(F+G*H)-I to postfix using the stack algorithm, where ^ has the highest precedence and is right-associative. Give the final postfix expression.',
    check: (a) => /ABCD\^E-FGH\*\+\^\*\+I-/.test(a.replace(/[\s`]+/g, '')),
    expect: 'ABCD^E-FGH*+^*+I-'
  },
  {
    id: 'evalpost', kind: 'exact',
    q: 'Evaluate the postfix expression 6 2 3 + - 3 8 2 / + * 2 ^ 3 + using a stack (^ is exponentiation). Show the stack after each step and give the final value.',
    check: (a) => finalNumber(a, /(final|value|result|answer)/i) === 52,
    expect: '52'
  },
  {
    id: 'bfsdfs', kind: 'exact',
    q: 'A directed graph has adjacency lists (neighbours visited in the listed order): 0: [1, 2], 1: [3, 4], 2: [5], 3: [], 4: [5], 5: []. Give the BFS order and the recursive DFS order starting from vertex 0.',
    check: (a) => /BFS[^\n]*?0\D+1\D+2\D+3\D+4\D+5/i.test(a.replace(/\*/g, '')) && /DFS[^\n]*?0\D+1\D+3\D+4\D+5\D+2/i.test(a.replace(/\*/g, '')),
    expect: 'BFS 0 1 2 3 4 5; DFS 0 1 3 4 5 2'
  },
  {
    id: 'hashing', kind: 'exact',
    q: 'Insert the keys 76, 93, 40, 47, 10, 55 in this order into a hash table of size 7 using h(k) = k mod 7 and linear probing. Give the final contents of slots 0 to 6.',
    check: (a) => {
      const t = a.replace(/\*/g, '')
      const slot = (i, v) => new RegExp(`(slot|index|\\[)\\s*${i}\\s*\\]?\\s*[:=\\-→|]+\\s*${v}\\b`, 'i').test(t) || new RegExp(`\\|\\s*${i}\\s*\\|\\s*${v}\\s*\\|`).test(t)
      return slot(0, 47) && slot(1, 55) && slot(2, 93) && slot(3, 10) && slot(5, 40) && slot(6, 76)
    },
    expect: '0:47 1:55 2:93 3:10 4:empty 5:40 6:76'
  }
]

/** Total page faults: the number on the last line that states a total of faults. */
function totalFaults(answer) {
  const lines = answer.replace(/\*/g, '').split('\n')
  const totalLines = lines.filter((l) => /total/i.test(l) && /faults?/i.test(l) && /\d/.test(l))
  const line = totalLines.at(-1) ?? lines.filter((l) => /faults?/i.test(l) && /\d/.test(l)).at(-1)
  if (!line) return NaN
  const m = /faults?[^0-9]{0,40}?(\d+)/i.exec(line) ?? /(\d+)[^0-9]{0,20}faults?/i.exec(line)
  return m ? Number(m[1]) : NaN
}

/**
 * AVL rotation check for one inserted key: within that insertion's own paragraph (from
 * "insert <key>" to the next insertion), the rotation type and the imbalance node must appear.
 */
function rotationFor(answer, key, typeRe, node) {
  const text = answer.replace(/\*/g, '')
  // Table layout: | key | lowest unbalanced node | rotation type | ...
  for (const row of text.split('\n').filter((l) => l.trim().startsWith('|'))) {
    const cells = row.split('|').map((c) => c.trim().replace(/`/g, ''))
    if (cells.includes(String(key)) && cells.includes(String(node)) && cells.some((c) => typeRe.test(c))) return true
  }
  const re = new RegExp(`insert(?:ing|ed)?\\s+(?:key\\s+)?${key}\\b`, 'gi')
  let m
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length)
    const next = rest.search(/\binsert(?:ing|ed)?\s+(?:key\s+)?\d+/i)
    const block = next >= 0 ? rest.slice(0, next) : rest.slice(0, 600)
    if (typeRe.test(block) && new RegExp(`\\b${node}\\b`).test(block)) return true
  }
  return false
}

/** Last integer mentioned near a keyword in the final part of the answer. */
function finalNumber(answer, keyword) {
  const tail = answer.slice(-900)
  const lines = tail.split('\n').filter((l) => keyword.test(l) && /\d/.test(l))
  const line = lines.at(-1) ?? tail
  const nums = line.replace(/\*/g, '').match(/-?\d+/g)
  return nums ? Number(nums.at(-1)) : NaN
}

/** Remove a top-level main() by matching braces (keeps any code after it). */
function removeMain(src) {
  const m = /\bint\s+main\s*\([^)]*\)\s*\{/.exec(src)
  if (!m) return src
  let depth = 0
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(0, m.index) + src.slice(i + 1)
  }
  return src.slice(0, m.index)
}

/** Grade one answer. Returns { pass, detail }. */
export function grade(problem, answer) {
  if (!answer || !answer.trim()) return { pass: false, detail: 'no answer' }
  if (problem.kind === 'exact') {
    const pass = problem.check(answer)
    return { pass, detail: pass ? `correct (${problem.expect})` : `WRONG (expected ${problem.expect})` }
  }
  const blocks = [...answer.matchAll(/```(?:cpp|c\+\+|C\+\+)[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1])
  const code = blocks.filter((b) => b.includes(problem.fn) && /class\s+Solution/.test(b)).at(-1) ?? blocks.filter((b) => b.includes(problem.fn)).at(-1)
  if (!code) return { pass: false, detail: 'no C++ solution found' }
  // Comments first (models often keep an example main() or LeetCode's struct definitions in comments).
  let src = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
  src = src.replace(/^\s*#include[^\n]*$/gm, '').replace(/^\s*using\s+namespace\s+std\s*;/gm, '')
  src = removeMain(src)
  const hasTree = /struct\s+TreeNode/.test(src)
  const hasList = /struct\s+ListNode/.test(src)
  const pre = PRELUDE + (problem.needs.includes('tree') && !hasTree ? TREE : '') + (problem.needs.includes('list') && !hasList ? LIST : '')
  const helpers = (problem.needs.includes('tree') ? BUILD_TREE : '') + CHECK
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsa-'))
  const file = path.join(dir, 'main.cpp')
  // Struct definitions come before the solution; test helpers after it.
  fs.writeFileSync(file, pre + src + '\n' + helpers + problem.harness)
  try {
    execFileSync('g++', ['-std=c++17', '-O1', '-o', path.join(dir, 'a.exe'), file], { stdio: 'pipe', timeout: 60000 })
  } catch (e) {
    return { pass: false, detail: 'does not compile: ' + (String(e.stderr).split('\n').find((l) => /error/.test(l)) ?? '').slice(0, 160) }
  }
  try {
    const out = execFileSync(path.join(dir, 'a.exe'), { encoding: 'utf8', timeout: 20000 })
    const m = /RESULT (\d+)\/(\d+)/.exec(out)
    const pass = !!m && m[1] === m[2]
    return { pass, detail: m ? `tests ${m[1]}/${m[2]}${pass ? '' : ' — ' + out.split('\n').filter((l) => l.startsWith('FAILED')).slice(0, 2).join('; ')}` : 'crashed: ' + out.slice(0, 120) }
  } catch (e) {
    return { pass: false, detail: 'runtime error / timeout' }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
