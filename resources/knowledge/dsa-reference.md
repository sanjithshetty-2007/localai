# DSA Reference (built-in)

Precise definitions of the standard data structures and algorithms taught in a Data Structures course. When the user names one of these, implement exactly that structure with all of its defining operations.

## Coding Rules for DSA Answers
Also called: program requirements, exam code format.
- Implement the exact structure that was asked for. Do not substitute a simpler one (an expression tree is not a BST; a circular queue is not a linear queue; a threaded binary tree is not a plain binary tree).
- Write a complete, compilable program: all includes, every function body, and a main() that builds a sample and prints results. Add the expected output as a comment.
- In C: check malloc for NULL, free all memory, use typedef struct, avoid non-standard headers (no conio.h). When .c and .h files are asked for, put the struct definitions and prototypes in the .h with include guards, the implementations in the .c, and a separate main.c (or main in the .c if asked).
- Prefer clear iterative or recursive code as taught in textbooks; name functions after the operation (push, pop, enqueue, insert, inorder…).
- State the time complexity of each operation.

## Binary Tree
Also called: binary tree traversal, tree traversals.
Definition: each node has at most two children, left and right.
Node: struct Node { int data; struct Node *left, *right; }.
Operations:
- Create node; build a tree (manually or from input with -1 meaning no child).
- Inorder (Left, Root, Right), Preorder (Root, Left, Right), Postorder (Left, Right, Root), recursive and iterative (inorder iterative uses a stack: push left chain, pop, visit, go right).
- Level-order traversal uses a queue (enqueue root; while queue not empty: dequeue, visit, enqueue left and right).
- Height = 1 + max(height(left), height(right)), height(NULL) = 0 (or -1 if counting edges). Count nodes, count leaves (left == right == NULL), mirror.
Properties: max nodes at level i = 2^i; max nodes in a tree of height h = 2^h − 1; a full binary tree with n internal nodes has n + 1 leaves; a complete binary tree is filled level by level from the left.
Complexity: every traversal O(n) time, O(h) extra space for recursion.

## Binary Search Tree
Also called: BST.
Definition: a binary tree where every key in the left subtree is smaller than the node and every key in the right subtree is larger. Inorder traversal gives keys in sorted order.
Operations:
- Search: compare with root, go left if smaller, right if larger.
- Insert: search for the key; attach a new node where the search ends at NULL.
- Delete, three cases: (1) leaf: remove it; (2) one child: replace the node with its child; (3) two children: copy the inorder successor (minimum of the right subtree) or predecessor into the node, then delete that successor from the right subtree.
- Find min (leftmost) and max (rightmost); inorder successor.
Complexity: O(h) per operation; O(log n) when balanced, O(n) worst case (sorted insertions make a chain).

## Expression Tree
Also called: binary expression tree, expression tree from postfix, construct expression tree.
Definition: a binary tree that represents an arithmetic expression. Leaves are operands (numbers or variables); internal nodes are operators (+, −, *, /, ^). Each operator node has exactly two children (its left and right operands). It is NOT a binary search tree: there is no ordering of keys and no BST insert.
Node: struct Node { char data; struct Node *left, *right; } (data holds an operator or an operand character; use a string/int field for multi-digit numbers).
Required operations:
1. Build from a postfix expression using a STACK of node pointers: scan left to right; if the symbol is an operand, create a node and push it; if it is an operator, create a node, pop the first pointer as its RIGHT child, pop the second as its LEFT child, push the new node. At the end the single node on the stack is the root.
2. (Optional) Build from infix by first converting infix to postfix with an operator stack (see Infix to Postfix), or build from prefix by scanning right to left (pop left first, then right).
3. Traversals: inorder gives the infix expression (print '(' before the left subtree and ')' after the right subtree for operator nodes to show the correct grouping); preorder gives prefix; postorder gives postfix.
4. Evaluate recursively: if the node is an operand return its value; otherwise evaluate left and right and apply the operator (left op right).
Example: postfix "ab+cd-*" builds root '*' with left subtree (a + b) and right subtree (c − d); inorder with brackets prints ((a+b)*(c-d)). Postfix "23+5*" evaluates to 25.
Complexity: build O(n) with a stack of size O(n); evaluation and traversals O(n).

## Threaded Binary Tree
Also called: inorder threaded binary tree, single threaded, double threaded, TBT.
Definition: a binary tree in which the NULL child pointers are replaced by "threads": a NULL right pointer points to the node's inorder successor and (in a double-threaded tree) a NULL left pointer points to its inorder predecessor. This allows inorder traversal without recursion and without a stack.
Node: struct Node { int data; struct Node *left, *right; int lthread, rthread; } where lthread = 1 means left is a thread (predecessor), lthread = 0 means left is a real child; same for rthread with right.
Header (dummy) node: many textbooks use a head node whose left points to the root (lthread = 0) and whose right points to itself; the leftmost node's left thread and the rightmost node's right thread point to the head. Without a head node those two threads are NULL.
Required operations:
1. Insert (BST order, maintaining threads): search for the parent. If inserting as a LEFT child of p: new->left = p->left (p's old predecessor), new->lthread = 1, new->right = p, new->rthread = 1, then p->left = new, p->lthread = 0. If inserting as a RIGHT child of p: new->right = p->right (p's old successor), new->rthread = 1, new->left = p, new->lthread = 1, then p->right = new, p->rthread = 0.
2. Inorder successor of node x: if x->rthread == 1 the successor is x->right; otherwise go to x->right and then follow left pointers while lthread == 0.
3. Inorder traversal WITHOUT stack or recursion: start at the leftmost node (from the root follow left while lthread == 0), visit it, then repeatedly move to the inorder successor (rule above) until reaching NULL (or the head node).
4. Preorder traversal is also possible without a stack using the threads.
5. (Optional) Delete with the three cases, repairing threads.
Advantages: no stack or recursion for traversal, O(1) extra space, fast successor/predecessor. Disadvantage: insertion and deletion are more complex.
Complexity: inorder traversal O(n) time, O(1) extra space.

## AVL Tree
Also called: height-balanced tree, self-balancing BST.
Definition: a BST in which for every node the balance factor = height(left) − height(right) is −1, 0 or +1.
Node: data, left, right, height.
Insertion: insert as in a BST, update heights on the way back up, and at the first unbalanced node apply a rotation:
- LL case (inserted into the left subtree of the left child): single right rotation.
- RR case (right subtree of the right child): single left rotation.
- LR case (right subtree of the left child): left rotation on the left child, then right rotation on the node.
- RL case (left subtree of the right child): right rotation on the right child, then left rotation on the node.
Right rotation of y: x = y->left; T2 = x->right; x->right = y; y->left = T2; update the heights of y then x; return x.
Deletion: BST delete, then rebalance with the same rotations up to the root.
Complexity: O(log n) search, insert, delete.

## Heap and Priority Queue
Also called: binary heap, max heap, min heap, heap sort, priority queue.
Definition: a complete binary tree stored in an array where every parent ≥ its children (max-heap) or ≤ its children (min-heap). For index i (0-based): left = 2i+1, right = 2i+2, parent = (i−1)/2.
Operations:
- Insert: put the element at the end and sift it up (swap with its parent while it is larger in a max-heap). O(log n).
- Delete max (extract root): move the last element to the root, shrink the size, sift down (swap with the larger child). O(log n).
- Heapify / build heap: call sift-down for i = n/2 − 1 down to 0. O(n).
- Heap sort: build a max-heap, then repeatedly swap the root with the last element and sift down on the reduced heap. O(n log n), in place, not stable.
A priority queue is usually implemented with a heap: enqueue = insert, dequeue = extract max/min.

## B-Tree
Also called: B tree of order m, multiway search tree.
Definition: a balanced m-way search tree. Every node has at most m children and m − 1 keys; every node except the root has at least ceil(m/2) children; the root has at least 2 children unless it is a leaf; all leaves are at the same level; keys inside a node are sorted.
Insertion: insert into the correct leaf; if it overflows (m keys), split it into two nodes and move the median key up to the parent; splits can propagate up to the root, which increases the height.
Deletion: remove the key; fix underflow by borrowing from a sibling or merging with a sibling.
Used in databases and file systems. Operations are O(log n).

## Trie
Also called: prefix tree, digital tree.
Definition: a tree for storing strings where each edge is a character; each node has up to 26 child pointers (for lowercase letters) and an end-of-word flag.
Operations: insert a word (create missing children along the path, mark the end), search a word (follow the path, check the end flag), prefix search (follow the path only). O(length of the word).

## Huffman Coding Tree
Also called: Huffman tree, optimal prefix codes.
Build: create a leaf for each character with its frequency, put them in a min-priority queue; repeatedly remove the two smallest, create a parent whose frequency is their sum, and insert it back, until one tree remains. Codes: left edge = 0, right edge = 1; read the path from the root to each leaf. More frequent characters get shorter codes. O(n log n).

## Constructing a Tree from Traversals
Also called: build tree from inorder and preorder, inorder and postorder.
From preorder + inorder: the first element of preorder is the root; find it in inorder; elements to its left form the left subtree and to its right the right subtree; recurse with the matching parts of preorder.
From postorder + inorder: the last element of postorder is the root; recurse the same way (build the right subtree first when consuming postorder from the end).
Preorder + postorder alone does not determine a unique binary tree (it does for a full binary tree).

## Graph Representation
Also called: adjacency matrix, adjacency list, graph terminology.
Terms: vertices V, edges E; directed or undirected; weighted or unweighted; degree (in-degree, out-degree); path, cycle, connected, complete graph, DAG.
Adjacency matrix: n×n array, adj[i][j] = 1 (or the weight) if edge i→j. O(V²) space, O(1) edge test. Good for dense graphs.
Adjacency list: an array of linked lists, one per vertex, listing its neighbours. O(V + E) space. Good for sparse graphs.
In C, adjacency list node: struct Node { int vertex; int weight; struct Node *next; }.

## Breadth First Search
Also called: BFS, level order graph traversal.
Algorithm (uses a QUEUE and a visited array): mark the start vertex visited and enqueue it; while the queue is not empty: dequeue u, visit u, and for each neighbour v of u that is not visited, mark v visited and enqueue v.
Uses: shortest path in an unweighted graph (store dist[v] = dist[u] + 1), connected components, bipartite check.
Complexity: O(V + E) with an adjacency list, O(V²) with a matrix.

## Depth First Search
Also called: DFS, graph traversal using stack, recursive DFS.
Algorithm (recursion or an explicit STACK, plus a visited array): DFS(u): mark u visited, visit u, for each neighbour v of u: if not visited, DFS(v). Iterative: push the start vertex; while the stack is not empty: pop u; if not visited, mark and visit it and push its unvisited neighbours.
Uses: cycle detection, topological sort, connected components, path finding, strongly connected components.
Complexity: O(V + E).

## Topological Sort
Also called: topological ordering, Kahn's algorithm.
Only for a DAG (directed acyclic graph): an order in which every edge u→v has u before v.
Kahn's algorithm (BFS): compute in-degrees; enqueue all vertices with in-degree 0; repeatedly dequeue u, output u, decrement the in-degree of each neighbour and enqueue it when it reaches 0. If fewer than V vertices are output, the graph has a cycle.
DFS method: run DFS; push each vertex onto a stack after all its neighbours finish; pop the stack for the order.
Complexity: O(V + E).

## Dijkstra's Algorithm
Also called: single source shortest path, Dijkstra.
For graphs with NON-NEGATIVE edge weights. dist[source] = 0, every other dist = infinity. Repeatedly pick the unvisited vertex u with the smallest dist (linear scan or min-heap), mark it visited, and relax every edge u→v: if dist[u] + w(u,v) < dist[v] then dist[v] = dist[u] + w(u,v) and parent[v] = u.
Complexity: O(V²) with an array, O((V + E) log V) with a binary heap. Fails with negative edges (use Bellman–Ford).

## Bellman-Ford Algorithm
Also called: shortest path with negative weights.
Relax all edges V − 1 times; then one more pass: if any edge can still be relaxed, there is a negative-weight cycle. O(V·E).

## Floyd-Warshall Algorithm
Also called: all pairs shortest path.
dist starts as the weight matrix (0 on the diagonal, infinity where there is no edge). For k = 0..n−1, for i, for j: dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j]). O(V³) time, O(V²) space.

## Minimum Spanning Tree: Prim's Algorithm
Also called: Prim, MST.
A spanning tree of a connected, undirected, weighted graph with the minimum total weight (V − 1 edges, no cycles).
Prim: start from any vertex; keep key[] (cheapest edge connecting each vertex to the tree) and inMST[]; repeatedly add the vertex with the smallest key that is not yet in the tree, then update the keys of its neighbours (key[v] = min(key[v], w(u,v)), parent[v] = u). O(V²) with a matrix, O(E log V) with a heap.

## Minimum Spanning Tree: Kruskal's Algorithm
Also called: Kruskal, union find, disjoint set.
Sort all edges by weight; take edges in increasing order and add an edge if it does not form a cycle, checked with union–find (find(x) with path compression, union by rank). Stop after V − 1 edges. O(E log E).

## Stack
Also called: stack using array, stack using linked list, push pop, LIFO.
Definition: a LIFO (last in, first out) list where insertion (push) and deletion (pop) happen at one end, the top.
Array implementation: int stack[MAX]; int top = -1. push: if top == MAX−1 then overflow, else stack[++top] = x. pop: if top == −1 then underflow, else return stack[top−−]. peek: stack[top]. isEmpty: top == −1. isFull: top == MAX−1.
Linked list implementation: push inserts at the head, pop removes the head; no overflow except when malloc fails.
All operations O(1).
Applications: infix to postfix conversion, postfix/prefix evaluation, balanced parentheses, function calls and recursion, undo, reversing a string, backtracking, DFS.

## Infix to Postfix Conversion
Also called: infix to postfix using stack, infix to prefix, polish notation.
Scan the infix expression left to right using an operator stack:
- Operand: append it to the output.
- '(' : push it.
- ')' : pop and output until '(' is found; discard the '('.
- Operator op: while the stack top is an operator with higher precedence, or equal precedence and op is left-associative, pop it to the output; then push op.
- At the end pop all remaining operators to the output.
Precedence: ^ (highest, right-associative) > * / % > + − (left-associative).
Example: A+B*C → ABC*+ ; (A+B)*C → AB+C* ; A+B*(C^D−E) → ABCD^E−*+.
Infix to prefix: reverse the infix expression, swap '(' and ')', convert to postfix (popping only on strictly higher precedence for left-associative operators), then reverse the result.

## Postfix Evaluation
Also called: evaluate postfix expression using stack, evaluate prefix.
Scan left to right with an operand stack: on an operand push its value; on an operator pop op2 (top), then op1, compute op1 operator op2 and push the result. At the end the stack holds the answer.
Example: 2 3 4 * + → 2 + 12 = 14 ; 5 3 + 8 2 − * → 8 * 6 = 48.
Prefix evaluation: scan right to left; on an operator pop op1 (top) then op2 and compute op1 operator op2.

## Balanced Parentheses
Also called: parenthesis matching using stack.
Scan the string: push every opening bracket ( [ {; on a closing bracket, if the stack is empty or the top is not the matching opening bracket the string is unbalanced, otherwise pop. Balanced only if the stack is empty at the end. O(n).

## Queue
Also called: linear queue, queue using array, queue using linked list, FIFO, enqueue dequeue.
Definition: a FIFO (first in, first out) list; insertion (enqueue) at the rear, deletion (dequeue) at the front.
Array (linear) queue: int q[MAX]; front = −1, rear = −1. enqueue: if rear == MAX−1 then overflow; if front == −1 then front = 0; q[++rear] = x. dequeue: if front == −1 or front > rear then underflow; x = q[front++]. Drawback: space before front is wasted, which is why the circular queue exists.
Linked list queue: keep front and rear pointers; enqueue appends at rear, dequeue removes at front; when the queue becomes empty set both to NULL.
Operations O(1).

## Circular Queue
Also called: circular queue using array, ring buffer.
Array where rear wraps around: front = rear = −1 initially.
- enqueue: if (rear + 1) % MAX == front then overflow (queue full). If front == −1 then front = 0. rear = (rear + 1) % MAX; q[rear] = x.
- dequeue: if front == −1 then underflow. x = q[front]; if front == rear (last element) then front = rear = −1, else front = (front + 1) % MAX.
- display: from i = front, printing q[i] and stepping i = (i + 1) % MAX, until i passes rear.
Alternative: keep a count variable; full when count == MAX, empty when count == 0.

## Deque
Also called: double ended queue, input restricted, output restricted.
Insertion and deletion at both ends: insertFront, insertRear, deleteFront, deleteRear (circular array or doubly linked list). Input-restricted deque: insert only at one end; output-restricted deque: delete only at one end.

## Queue Using Two Stacks and Stack Using Two Queues
Also called: queue using two stacks, stack using two queues, queue using stacks, stack using queues.
Queue with two stacks: enqueue pushes onto s1; dequeue: if s2 is empty, pop everything from s1 and push it onto s2; then pop from s2 (amortized O(1)).
Stack with two queues: push enqueues onto q2, moves every element of q1 to q2, then swaps q1 and q2; pop dequeues from q1.

## Singly Linked List
Also called: linked list, SLL, insert at beginning, delete node, reverse linked list.
Node: struct Node { int data; struct Node *next; }; head points to the first node.
Operations: insert at the beginning (new->next = head; head = new), at the end (walk to the last node), at a position; delete from the beginning, the end, by value, by position; search; display; count; reverse (three pointers prev, curr, next: next = curr->next; curr->next = prev; prev = curr; curr = next; finally head = prev).
Complexity: insert at head O(1); search, insert/delete at the end or a position O(n).

## Doubly Linked List
Also called: DLL, two way linked list.
Node: data, prev, next. Insertion and deletion update both links (for example, delete p: p->prev->next = p->next; if p->next then p->next->prev = p->prev). Traversal in both directions.

## Circular Linked List
Also called: circular singly linked list, CLL.
The last node points back to the first (keep a pointer to the last node so insertion at both ends is O(1)). Traversal stops when it returns to the start (do-while loop). Used for round-robin scheduling and circular buffers.

## Polynomial Representation Using Linked List
Also called: polynomial addition, polynomial linked list.
Each node stores coef, exp and next, sorted by decreasing exponent. Addition: walk both lists; equal exponents → add the coefficients; otherwise copy the term with the larger exponent; append the leftovers.

## Hashing
Also called: hash table, collision resolution, linear probing, chaining.
Hash function maps a key to an index, for example h(k) = k mod m (choose m prime).
Collision resolution:
- Separate chaining: each slot holds a linked list of keys.
- Open addressing: linear probing (h(k) + i) mod m; quadratic probing (h(k) + i²) mod m; double hashing (h1(k) + i·h2(k)) mod m.
Load factor α = n/m; average search O(1 + α) with chaining. Linear probing causes primary clustering; quadratic probing causes secondary clustering. Deletion in open addressing uses a "deleted" marker.

## Searching and Sorting Summary
Also called: sorting algorithms, binary search, linear search, bubble sort, selection sort, insertion sort, merge sort, quick sort.
Linear search O(n). Binary search on a sorted array: low, high, mid = (low + high)/2; compare; O(log n).
Bubble sort O(n²), stable. Selection sort O(n²), not stable. Insertion sort O(n²) worst, O(n) best, stable. Merge sort O(n log n), stable, O(n) extra space (divide, sort halves, merge). Quick sort O(n log n) average, O(n²) worst (partition around a pivot; Lomuto or Hoare). Heap sort O(n log n), in place. Counting and radix sort O(n + k).
