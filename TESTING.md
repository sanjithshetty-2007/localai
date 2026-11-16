# Test results

Run on 2026-11-16 on Windows 11 (Intel Core Ultra 9 275HX, 31 GB RAM, RTX 5070 Laptop 8 GB), Balanced profile, Ollama 0.40.16, models `qwen2.5-coder:7b` and `qwen2.5vl:3b`. All AI answers came from the local models; nothing was mocked.

## Automated checks

| Check | Result |
|---|---|
| `npm run typecheck` (main + renderer) | ✅ no errors |
| `npm test`: 25 unit tests (command allowlist, action parser, PDF question extraction, error parsing for Python/g++/javac/Node, ZIP traversal/symlink/bomb rejection) | ✅ 25/25 |
| `npm run build` | ✅ |
| `npm run dist:win` | ✅ `release/1.0.0/LocalCode AI Studio-Setup-1.0.0.exe` (130 MB) and `…-win-x64.zip` (164 MB) |

## Acceptance tests (Playwright driving the real Electron app)

| # | Test | Result | Notes |
|---|---|---|---|
| 1 | General conversation | ✅ | Streamed answer from qwen2.5-coder:7b (route: general). The first request includes model load time (~50 s cold); later replies took 3–6 s. |
| 2 | Code generation | ✅ | "Write a Python program primes.py…" produced a `create_file src/primes.py` change set. Accept wrote the file and opened it in Monaco. |
| 3 | Code execution | ✅ | Real `python -u`: output `2 3 5 … 47`, exit 0, duration shown. Also verified C++ (g++), JavaScript, TypeScript (Node 24) and interactive stdin. |
| 4 | Automatic debugging | ✅ | NameError captured at line 5. **Fix Error with AI** produced a +1 −1 patch in 4 s. **Accept & Re-run** showed "Verified: the program ran successfully (exit 0)". |
| 5 | Screenshot analysis | ✅ | IDE screenshot read by qwen2.5vl:3b, answer written by qwen2.5-coder:7b in one reply. It identified `NameError: name 'value'…` and gave the fix. |
| 6 | PDF analysis | ✅ | 2-page PDF extracted locally. "Solve question 2" pulled out that section and proposed `palindrome.py`, which ran successfully. |
| 7 | ZIP project analysis | ✅ (after fix) | First run failed: the request went out before the re-index had run. Fixed by indexing right away and adding the extracted files to the context. Re-run answered "uses Flask… route `/` returns 'ok'". |
| 8 | Multi-file application | ⚠️ partial | 4 files written (`app.py`, `templates/index.html`, `static/style.css`, `static/app.js`) in 40 s. The 7B model left out the requested `requirements.txt` and `README.md`, and `app.js` was a stub. All proposed files were written correctly; the gap is in what the model generated. |
| 9 | Conversation continuity | ✅ | "In the stats file you just fixed, what was the bug?" was answered correctly from conversation history. |
| 10 | Offline / no cloud requests | ✅ (as verified) | The packaged app made **0** renderer network requests. Every main-process `fetch` goes to the configured Ollama URL (localhost). I didn't physically disconnect the network during the test. |
| 11 | Packaged build | ✅ | `win-unpacked/LocalCode AI Studio.exe` launched. SQLite and node-pty loaded from `app.asar.unpacked`, the PTY shell started, Python ran and the assistant answered. The NSIS installer was built but not run, to avoid changing this machine. |

Also checked: path traversal through the AI edit path is refused ("Path is outside the workspace"); diff → accept → editor refresh → undo restores the original; ZIP extraction into the workspace; Dark+/Light+ themes; Settings shows detected hardware (RTX 5070 8 GB via nvidia-smi, recommended Balanced).

## Update: model set, profiles and knowledge library (2026-11-16, later run)

Models: `qwen3:8b` (conversation), `qwen2.5-coder:7b` (code), `deepseek-r1:8b` (reasoning), `qwen2.5vl:7b` (vision), `nomic-embed-text` (embeddings); Balanced (8 GB) profile, 8192 context.

| Check | Result | Notes |
|---|---|---|
| Unit tests | ✅ 32/32 | New: syllabus "Unit III"/"Module 2" sections, chunking, cosine, rank fusion, DOCX text |
| Settings migration | ✅ | An existing profile was switched to the new model set on first launch |
| Conversation → qwen3:8b | ✅ | 24 s including model load |
| Code → qwen2.5-coder:7b | ✅ | `fib.py` proposed in 9.6 s |
| Vision → qwen2.5vl:7b + coder | ✅ | Read the IDE screenshot and gave the NameError fix (26.7 s) |
| Knowledge library | ✅ | 3-page syllabus PDF embedded locally. "What's in Unit 3 / end-sem marks?" answered exactly from the PDF (all Unit III topics, 50 marks). A related question without the word "syllabus" used the Unit II passage. An unrelated request used no library passages. |
| Reasoning → deepseek-r1:8b | ⚠️ fixed, not re-run | First run: deepseek-r1:8b used the whole 4,096-token budget and then produced nonsense. Measured directly at 58 tok/s, 100% on the GPU: it needs ~5,500 thinking tokens for a simple FIFO problem, and with room it got the right answer (6). Fix: 6,000-token budget at temperature 0.6, reasoning prompts without project files, and qwen3:8b writes the final answer if the budget runs out. The full role test wasn't re-run at the user's request. |
| GPU fit (8 GB) | ✅ | deepseek-r1:8b at 8K context: 6.2 GB, 100% GPU |

## Update: DSA answer quality (2026-11-17)

User report: "expression tree" came back as a generic binary tree, "threaded binary tree" was also wrong, and no files were saved.

Diagnosis from the installed app's database: the request went to the right model (`qwen2.5-coder:7b`, route `code`) with clean context. Causes: (1) the 7B model's knowledge of less common structures; (2) the parser didn't recognise file names written as `### Header File: \`tree.h\`` or `// file=src/tree.c`, so nothing was saved.

Fixes: a built-in DSA reference with exact-name section matching; DSA rules in the system prompt; compile check plus automatic repair; parsing of both file-name formats; `qwen2.5-coder:14b` as the Balanced code model (measured 57% GPU / 43% RAM, 13.9 tok/s).

| Request | 7B before | 7B after fixes | 14B after fixes |
|---|---|---|---|
| "give code for expression tree in .c and .h" | ❌ generic tree, no files | ✅ right structure (postfix + stack + evaluate), ❌ still had compile errors after 2 repairs | ✅ right structure, compile check passed, 3 files proposed; **ran: `((2+3)*5)` = 25** (93 s) |
| "write a threaded binary tree program in C" | ❌ | ✅ thread flags + successor inorder, compiles | ✅ compiles, 3 files proposed (93 s) |

Unit tests: 35/35 (new: heading and comment file-name formats, `#include` not mistaken for a file).

## Update: course slides + hidden assistant (2026-11-17)

| Check | Result |
|---|---|
| "DSA Conceptual Full Slides.pdf" added to the user's real library | ✅ 455 pages → 155 passages (headers/dates stripped), all embedded with nomic-embed-text |
| Retrieval from the slides | ✅ threaded-tree insertion → p.252, p.256 · AVL LR rotation → p.292 · infix→postfix → p.73, p.76 · circular queue → p.117 (the built-in reference is listed first) |
| Ctrl+Shift (bare) hides / shows the assistant | ✅; Ctrl+Shift+F does not toggle |
| Request while hidden | ✅ finished in the background; no status-bar AI text, no tabs opened; reply waiting when shown again |
| Pane crash isolation | ✅ error boundaries per pane (found when a welcome-screen typo blanked the app during testing) |
| Unit tests | ✅ 36/36 |

## Re-running

```bash
npm run build
node scripts/make-test-pdf.mjs "$E2E_OUT/assignment.pdf"   # plus a project.zip in $E2E_OUT
node scripts/e2e.mjs smoke <ws>
node scripts/e2e.mjs execution <ws>
node scripts/e2e.mjs attachments <ws>
node scripts/e2e.mjs ai <ws>            # E2E_ONLY=chat,code,fix,followup,pdf,zip,vision,app
E2E_EXE="release/1.0.0/win-unpacked/LocalCode AI Studio.exe" node scripts/e2e.mjs packaged <ws>
```
