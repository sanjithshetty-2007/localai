// Validates the graders: reference solutions must pass, wrong answers must fail.
import { PROBLEMS, grade } from './problems.mjs'

const cpp = (s) => '```cpp\n' + s + '\n```'
const REF = {
  lc863: cpp(`class Solution { public:
  vector<int> distanceK(TreeNode* root, TreeNode* target, int k) {
    unordered_map<TreeNode*, TreeNode*> par; function<void(TreeNode*,TreeNode*)> dfs = [&](TreeNode* n, TreeNode* p){ if(!n) return; par[n]=p; dfs(n->left,n); dfs(n->right,n); };
    dfs(root, nullptr); unordered_set<TreeNode*> seen{target}; queue<TreeNode*> q; q.push(target); int d=0;
    while(!q.empty()){ if(d==k){ vector<int> r; while(!q.empty()){ r.push_back(q.front()->val); q.pop(); } return r; }
      for(int s=q.size(); s>0; --s){ TreeNode* n=q.front(); q.pop(); for(TreeNode* x : {n->left,n->right,par[n]}) if(x && !seen.count(x)){ seen.insert(x); q.push(x); } } d++; }
    return {}; } };`),
  lc102: cpp(`class Solution { public: vector<vector<int>> levelOrder(TreeNode* root){ vector<vector<int>> r; if(!root) return r; queue<TreeNode*> q; q.push(root);
    while(!q.empty()){ vector<int> l; for(int s=q.size(); s>0; --s){ auto n=q.front(); q.pop(); l.push_back(n->val); if(n->left) q.push(n->left); if(n->right) q.push(n->right);} r.push_back(l);} return r; } };`),
  lc236: cpp(`class Solution { public: TreeNode* lowestCommonAncestor(TreeNode* r, TreeNode* p, TreeNode* q){ if(!r||r==p||r==q) return r; auto a=lowestCommonAncestor(r->left,p,q), b=lowestCommonAncestor(r->right,p,q); return a&&b? r : (a? a: b); } };`),
  lc207: cpp(`class Solution { public: bool canFinish(int n, vector<vector<int>>& pre){ vector<vector<int>> g(n); vector<int> in(n); for(auto&e: pre){ g[e[1]].push_back(e[0]); in[e[0]]++; }
    queue<int> q; for(int i=0;i<n;i++) if(!in[i]) q.push(i); int c=0; while(!q.empty()){ int u=q.front(); q.pop(); c++; for(int v: g[u]) if(--in[v]==0) q.push(v);} return c==n; } };`),
  lc743: cpp(`class Solution { public: int networkDelayTime(vector<vector<int>>& t, int n, int k){ vector<vector<pair<int,int>>> g(n+1); for(auto&e: t) g[e[0]].push_back({e[1],e[2]});
    vector<long long> d(n+1, LLONG_MAX); priority_queue<pair<long long,int>, vector<pair<long long,int>>, greater<>> pq; d[k]=0; pq.push({0,k});
    while(!pq.empty()){ auto [du,u]=pq.top(); pq.pop(); if(du>d[u]) continue; for(auto [v,w]: g[u]) if(du+w<d[v]){ d[v]=du+w; pq.push({d[v],v}); } }
    long long m=0; for(int i=1;i<=n;i++){ if(d[i]==LLONG_MAX) return -1; m=max(m,d[i]); } return (int)m; } };`),
  lc84: cpp(`class Solution { public: int largestRectangleArea(vector<int>& h){ stack<int> s; int best=0, n=h.size(); for(int i=0;i<=n;i++){ int cur = i==n? 0 : h[i];
    while(!s.empty() && h[s.top()]>=cur){ int ht=h[s.top()]; s.pop(); int w = s.empty()? i : i-s.top()-1; best=max(best, ht*w);} s.push(i);} return best; } };`),
  lc239: cpp(`class Solution { public: vector<int> maxSlidingWindow(vector<int>& a, int k){ deque<int> d; vector<int> r; for(int i=0;i<(int)a.size();i++){ while(!d.empty()&&d.front()<=i-k) d.pop_front();
    while(!d.empty()&&a[d.back()]<=a[i]) d.pop_back(); d.push_back(i); if(i>=k-1) r.push_back(a[d.front()]);} return r; } };`),
  lc150: cpp(`class Solution { public: int evalRPN(vector<string>& t){ stack<long long> s; for(auto&x: t){ if(x=="+"||x=="-"||x=="*"||x=="/"){ long long b=s.top(); s.pop(); long long a=s.top(); s.pop();
    s.push(x=="+"? a+b : x=="-"? a-b : x=="*"? a*b : a/b);} else s.push(stoll(x)); } return (int)s.top(); } };`),
  lc25: cpp(`class Solution { public: ListNode* reverseKGroup(ListNode* head, int k){ ListNode d(0, head); ListNode* g=&d; while(true){ ListNode* kth=g; for(int i=0;i<k&&kth;i++) kth=kth->next; if(!kth) break;
    ListNode* nxt=kth->next; ListNode* prev=nxt; ListNode* cur=g->next; while(cur!=nxt){ ListNode* t=cur->next; cur->next=prev; prev=cur; cur=t; } ListNode* first=g->next; g->next=kth; g=first; } return d.next; } };`),
  fifo: 'Step by step ...\n\n**Total number of page faults: 15**',
  avl: 'Insert 30: imbalance at 10, RR rotation at node 10.\nInsert 50: imbalance at 30, RR rotation at node 30.\nInsert 25: imbalance at 20, RL rotation at node 20.\n\nFinal preorder: 30, 20, 10, 25, 40, 50',
  postfix: 'Final postfix expression: `ABCD^E-FGH*+^*+I-`',
  evalpost: '... **Final value: 52**',
  bfsdfs: '**BFS order:** 0, 1, 2, 3, 4, 5\n**DFS order:** 0, 1, 3, 4, 5, 2',
  hashing: '| Slot | Key |\n|---|---|\n| 0 | 47 |\n| 1 | 55 |\n| 2 | 93 |\n| 3 | 10 |\n| 4 | empty |\n| 5 | 40 |\n| 6 | 76 |'
}
// Alternative layouts real models produced (must also pass).
const ALT = {
  fifo: '- **Total faults**: Counted as 15 (matches step-by-step simulation).\n\n### Complexity\n- Space: O(k) where k = number of frames (k=3 here).',
  avl: '- **Insert 30**: Imbalance occurs at **node 10** (balance factor = -2).\n  → **RR rotation** (right-right case).\n\n- **Insert 50**: Imbalance occurs at **node 30**.\n  → **RR rotation**.\n\n- **Insert 25**: Imbalance occurs at **node 20**.\n  → **RL rotation** (right rotation on 40, then left rotation on 20).\n\n### Preorder\n**30 → 20 → 10 → 25 → 40 → 50**'
}
ALT['avl#table'] = '| Inserted Key | Lowest Unbalanced Node | Rotation Type |\n|---|---|---|\n| 30 | 10 | RR |\n| 40 | None | - |\n| 50 | 30 | RR |\n| **25** | **20** | **RL** |\n\nPreorder Traversal: `30, 20, 10, 25, 40, 50`'
const WRONG = {
  lc84: cpp(`class Solution { public: int largestRectangleArea(vector<int>& h){ int m=0; for(int x: h) m=max(m,x); return m; } };`),
  lc863: cpp(`class Solution { public: vector<int> distanceK(TreeNode* root, TreeNode* target, int k){ return {}; } };`),
  fifo: '**Total number of page faults: 14**',
  'fifo#2': '- **Total faults**: Counted as 14.\n- k=15 frames',
  'avl#table': '| Key | Node | Type |\n| 30 | 10 | RR |\n| 50 | 20 | RR |\n| 25 | 20 | RL |\nPreorder: 30, 20, 10, 25, 40, 50',
  'avl#2': '- Insert 30: imbalance at node 10, RR rotation.\n- Insert 50: imbalance at node 20, RR rotation.\n- Insert 25: imbalance at node 20, RL rotation.\nPreorder: 30, 20, 10, 25, 40, 50',
  avl: 'Final preorder: 20, 10, 30, 25, 40, 50',
  hashing: '| 0 | 55 |\n| 1 | 47 |'
}

let bad = 0
for (const p of PROBLEMS) {
  const r = grade(p, REF[p.id])
  console.log(`${r.pass ? 'ok  ' : 'BAD '} reference ${p.id.padEnd(9)} ${r.detail}`)
  if (!r.pass) bad++
}
for (const [key, ans] of Object.entries(ALT)) {
  const id = key.split('#')[0]
  const r = grade(PROBLEMS.find((p) => p.id === id), ans)
  console.log(`${r.pass ? 'ok  ' : 'BAD '} alt layout ${id.padEnd(9)} ${r.detail}`)
  if (!r.pass) bad++
}
for (const [key, ans] of Object.entries(WRONG)) {
  const id = key.split('#')[0]
  const r = grade(PROBLEMS.find((p) => p.id === id), ans)
  console.log(`${r.pass ? 'BAD ' : 'ok  '} wrong     ${id.padEnd(9)} ${r.detail}`)
  if (r.pass) bad++
}
console.log(bad ? `${bad} GRADER PROBLEMS` : 'GRADERS OK')
process.exitCode = bad ? 1 : 0
