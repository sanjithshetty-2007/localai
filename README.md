# LocalCode AI Studio

A local-first desktop IDE with one built-in AI assistant. It combines a VS Code-style editor (Monaco), a file explorer, a terminal and code runner, and a single chat sidebar. All AI requests go to models running on your own machine through [Ollama](https://ollama.com).

- **One assistant, one conversation.** General questions, coding, debugging, screenshots, PDFs and ZIP repositories all go through the same chat, with the same history and memory. The app picks a suitable local model for each request and doesn't show you that routing.
- **Works offline.** There's no cloud AI, no telemetry and no account. You only need internet once, to install Ollama and download models.
- **Edits real files.** The assistant proposes file changes as structured actions. You review each one in a diff and accept or reject it, and you can undo it afterwards.
- **Fixes its own errors.** When a run fails, **Fix Error with AI** sends the error and the source to the assistant. You accept the patch, the app re-runs the program, and it reports whether the fix worked.

---

## Install (Windows): start here

You only need to download one file. The app installs everything else on first launch.

1. Open **[Releases → latest](https://github.com/sanjithshetty-2007/localai/releases/latest)** and download **`LocalCode-AI-Studio-Setup-<version>.exe`**.
2. Run it. If Windows shows *"Windows protected your PC"*, click **More info → Run anyway**. The installer isn't code-signed, which is normal for a free open-source app.
3. Open **LocalCode AI Studio**. The **setup wizard** opens by itself:
   - **Your computer**: it detects your GPU and RAM and recommends a profile. Pick **Balanced (8 GB)** for an 8 GB GPU or **Lite (6 GB)** for 6 GB or less.
   - **Install Ollama**: one click. It uses `winget`, or else the official signed installer from ollama.com (about 1 GB).
   - **Download models**: one click. That's about 26 GB for Balanced or 21 GB for Lite. A download that stalls resumes on its own, and **Pause** keeps what has already downloaded.
4. Click **Finish**. From now on everything runs **offline**.

**Updates:** from version 1.0.4 on, the Windows app updates itself. It checks GitHub, downloads new versions in the background, and installs them when you close the app (or click **Restart to update** in the status bar). On macOS the app tells you when a new version is out and opens the download. Turn this off under **Settings → About → Check for updates automatically**; it only ever contacts github.com. Copies older than 1.0.4 need to install the new version once by hand.

Recommended hardware: Windows 10/11 64-bit, an NVIDIA GPU with 6 GB+ VRAM, 16 GB+ RAM (24–32 GB is better), and about 35 GB of free disk. It also runs on the CPU only, but slowly.

Optional:
- **Course notes**: click the 📖 **Knowledge** icon on the left and add your syllabus or slides (PDF, DOCX, TXT, MD). The assistant then uses them as reference and cites page numbers. A DSA reference is built in.
- **Running code**: install the language you need. Python from python.org; C/C++ via MSYS2 (`g++`); Java via a JDK. **Settings → Runtimes** shows what's missing.
- To run the setup again later: **Settings → Ollama → Run setup wizard**.

## Install (macOS)

Requires macOS 12 or newer. Apple Silicon (M1–M4) is strongly recommended. Intel Macs run the models on the CPU, which is slow.

1. From **[Releases → latest](https://github.com/sanjithshetty-2007/localai/releases/latest)**, download **`LocalCode-AI-Studio-<version>-mac-arm64.dmg`** for Apple Silicon or **`…-mac-x64.dmg`** for Intel Macs. To check which Mac you have:  → About This Mac → *Chip*.
2. Open the `.dmg` and drag **LocalCode AI Studio** into **Applications**.
3. **First launch:** the app isn't notarized by Apple (that needs a paid Apple Developer account), so macOS asks for confirmation once:
   - macOS 15 Sequoia and newer: open the app. When it's blocked, go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**, then confirm.
   - macOS 12–14: **right-click** the app in Applications → **Open** → **Open**.
   - If macOS says the app *"is damaged and can't be opened"*, run this once in Terminal, then open it again:
     ```bash
     xattr -dr com.apple.quarantine "/Applications/LocalCode AI Studio.app"
     ```
4. The **setup wizard** installs Ollama: it downloads Apple's signed `Ollama.app` from ollama.com, checks the signature, and puts it in Applications. Then it downloads the models. It recommends a profile from your unified memory: **Lite** for 8–16 GB, **Balanced** for 24 GB+, **Deep** for 48 GB+.

Running code on a Mac: C/C++ need Apple's Command Line Tools (`xcode-select --install`). Python, Node.js and Java can come from Homebrew or their installers. The app also finds tools installed with Homebrew.

Every release build is checked automatically on a real Mac before it's published. The check covers the signature, the database and terminal native modules for Apple Silicon and Intel, and a launch of the packaged app that tests the window, database, terminal and code runner.

Linux (`.AppImage`) is built too but hasn't been tested. Install Ollama with `curl -fsSL https://ollama.com/install.sh | sh` first; the wizard then downloads the models.

---

## Requirements

| What | Why | Install |
|---|---|---|
| **Ollama** ≥ 0.6 | Runs the AI models | <https://ollama.com/download> · Windows: `winget install Ollama.Ollama` · macOS: `brew install ollama` · Linux: `curl -fsSL https://ollama.com/install.sh \| sh` |
| The model set | One model per kind of work | `ollama pull qwen3:8b` · `ollama pull qwen2.5-coder:7b` · `ollama pull deepseek-r1:8b` · `ollama pull qwen2.5vl:7b` · `ollama pull nomic-embed-text`. You can also download them from **Settings → Models** in the app. |
| Python / g++ / JDK / Node.js (optional) | Running your code | Only for the languages you want to run. The app finds them and shows install hints. JavaScript also runs on the app's built-in runtime. |

For development you also need Node.js 22 or newer and npm.

Model weights aren't bundled with the installer because they're several GB each. The app shows which models are installed and downloads new ones through Ollama's `/api/pull`, with a progress bar.

### Hardware profiles

The assistant picks one of these internal models for each request:

| Role | Model | Used for |
|---|---|---|
| Conversation | `qwen3:8b` | General questions, explanations, documents (thinking mode off for speed) |
| Code | `qwen2.5-coder:14b` on Balanced (split GPU + RAM, ~14 tok/s) · `qwen2.5-coder:7b` on Lite | Writing and editing files, debugging, fixing errors, repository questions. Every C/C++/Java/Python answer is compile-checked (never run) and repaired automatically, up to two rounds. |
| Reasoning | `deepseek-r1:8b` | Algorithms, maths, OS/scheduling problems, step-by-step work (its reasoning appears under "Reasoning" in the chat). Prompted the way DeepSeek recommends for R1 (no system prompt, temperature 0.6, top_p 0.95), with a context window sized so the question is never pushed out. **Settings → Generation → Reasoning depth** sets how long it may think: 8K, 16K or 24K tokens. This R1-0528 distill often deliberates past any budget; when it runs out, or a loop detector sees sustained repetition (≥50%), the coding or conversation model writes the final answer from its reasoning, and code is compile-checked. |
| Vision | `qwen2.5vl:7b` | Screenshots and images. It reads the image, then the conversation or code model writes the answer. |
| Embeddings | `nomic-embed-text` | Semantic search over your knowledge library (syllabus, notes) |

| Profile | Hardware | Models | Context | What to expect |
|---|---|---|---|---|
| **Balanced (8 GB)**, default | 8 GB VRAM + 32 GB RAM (e.g. RTX 5070 Laptop) | the set above | 8192 | Each 7–8B model (≈5–7 GB with an 8K context) runs on the GPU, one at a time |
| **Lite (6 GB)** | 6 GB VRAM + 24 GB RAM | the same set | 6144 | Ollama keeps a few layers of the 8B and vision models in system RAM, so replies are somewhat slower. You can raise the context to 8192 in Settings at more cost. |
| Deep (12 GB+) | 12 GB+ VRAM, 32 GB+ RAM | `qwen3:14b`, `qwen2.5-coder:14b`, `deepseek-r1:14b`, `qwen2.5vl:7b` | 16384 | Slower, much more memory |

The app reads RAM, CPU and GPU (exact VRAM through `nvidia-smi`; WMI, `system_profiler` or `lspci` otherwise, which may be less precise) and recommends a profile. You can override it in the title bar or in Settings. By default only one model stays in memory at a time (`keep_alive: "10m"`, other models are unloaded before a new one loads). Speed depends on quantization, context size, Ollama version and GPU, so the app doesn't promise any particular speed.

---

## Commands

```bash
npm install          # install dependencies
npm run dev          # run the app with hot reload
npm run typecheck    # TypeScript checks (main + renderer)
npm test             # unit tests (vitest)
npm run build        # typecheck + production bundles in out/
npm run dist         # build + installers for the current platform
npm run dist:win     # Windows: NSIS installer + portable ZIP
npm run dist:mac     # macOS: DMG (x64 + arm64) — must run on macOS
npm run dist:linux   # Linux: AppImage + .deb — run on Linux
```

Installers are written to `release/<version>/`, for example `release/1.0.0/LocalCode-AI-Studio-Setup-1.0.0.exe`.

**Publishing a release:** pushing a tag like `v1.0.1` (after bumping `version` in `package.json`) runs `.github/workflows/release.yml`. GitHub builds the Windows, macOS and Linux installers and attaches them to a GitHub Release:

```bash
git tag v1.0.1
```
```bash
git push origin v1.0.1
``` Build each platform on that platform; one binary can't run on every OS.

> **npm 11 note:** npm 11 doesn't run install scripts by default. If `node_modules/electron/dist` is missing after `npm install`, run `node node_modules/electron/install.js` once. Native modules don't need compiling: `better-sqlite3` v13 and `@lydell/node-pty` ship prebuilt N-API binaries, so you don't need Visual Studio or Xcode build tools.

### End-to-end tests

`scripts/e2e.mjs` launches the built app with Playwright's Electron driver, runs a scenario and saves screenshots:

```bash
npm run build
node scripts/e2e.mjs smoke <workspaceDir>        # UI, editor, terminal, themes, settings
node scripts/e2e.mjs execution <workspaceDir>    # Python/C++/JS/TS runs, errors, stdin
node scripts/e2e.mjs attachments <workspaceDir>  # PDF + ZIP processing, diff/accept/undo
node scripts/e2e.mjs ai <workspaceDir>           # real Ollama tests (needs a model)
```

Set `E2E_OUT` to choose where screenshots go. The `attachments` and `ai` scenarios expect `assignment.pdf` (from `node scripts/make-test-pdf.mjs`) and `project.zip` in that folder.

---

## Using it

- **Open a folder** (Ctrl+O). The explorer supports new file/folder, rename, delete (moves to the system trash), drag-and-drop move, ZIP import/export, a context menu and refresh.
- **Edit** with Monaco: tabs, unsaved-change dots, minimap, bracket colours, find/replace (Ctrl+F / Ctrl+H), Save (Ctrl+S) and Save As (Ctrl+Shift+S). Run errors show as squiggles.
- **Run** the active file with F5. It works for Python, C/C++ (g++), Java (javac + java), JavaScript and TypeScript (Node ≥ 22.6). Output, stderr, exit code and duration appear in the Output panel, and you can type stdin for interactive programs. The Terminal tab is a real PTY shell.
- **Chat** in the right sidebar. Attach PNG/JPG/WEBP, PDF, text/code files or ZIP with the paperclip, by drag-and-drop, or paste images with Ctrl+V. The assistant automatically sees the active file, your selection, open tabs, the last run's errors, terminal output, relevant indexed project files, attachments, earlier messages and project memory.
- **Knowledge library** (book icon in the activity bar): add your syllabus, course outline, notes or reference PDFs (PDF, DOCX, TXT, MD), or drop them on the panel. Each document is split into passages and embedded locally with `nomic-embed-text`. For every request the assistant runs a hybrid search (semantic plus keyword, plus whole "Unit III" / "Module 2" / "Question 4" sections when you name one) and adds the matching passages as a *Reference library* block. It follows your syllabus's topics and terms and cites sources like `[syllabus.pdf p.3]`. Unrelated requests (for example "write a function that adds two numbers") don't pull the library in. The library is shared by all conversations; you can switch individual documents on or off, test retrieval in the panel, and turn it all off in Settings. If the embedding model is missing, the library falls back to keyword search.
- **Built-in DSA reference**: the library ships with a reference covering trees (binary, BST, expression, threaded, AVL, heap, B-tree, trie, Huffman), graphs (BFS, DFS, topological sort, Dijkstra, Bellman–Ford, Floyd–Warshall, Prim, Kruskal), stacks (infix→postfix, evaluation, parentheses), queues (linear, circular, deque, two-stack), linked lists, hashing and sorting. When you name a structure, its exact definition and required operations go to the model, so an "expression tree" can't come back as a BST.
- **Review AI changes**: file proposals appear as a *Proposed changes* card with +/− counts. **Review** opens a red/green diff tab. You can accept or reject each file or all at once, and **Undo** afterwards. Deletes, renames and commands always ask first. Commands must be on an allowlist and can't use shell operators.
- **Self-healing**: when a run fails, click **Fix Error with AI**, then **Accept & Re-run**. The card shows *Verified* or *Still failing*. After three failed attempts it asks you to review the code yourself instead of looping.

**Hidden assistant:** press and release **Ctrl+Shift** on its own (or Ctrl+Shift+A, or the title-bar button) to hide the assistant panel. It stays loaded and keeps working: requests finish, change cards wait in the chat. While it's hidden nothing AI-related appears in the main window (no auto-opened diff tabs, no AI toasts, no AI status-bar text). Press Ctrl+Shift again to bring it back. Combinations like Ctrl+Shift+F don't toggle it. If Windows is set to switch keyboard layouts with Ctrl+Shift, that will also fire; use Ctrl+Shift+A instead.

**Slide-deck PDFs** (for example full course slides) are cleaned when added to the library: header and footer lines repeated on many slides are removed, and consecutive slides are merged into passages with `[p.N]` markers, so citations point to the right slide.

Shortcuts: Ctrl+L focus chat · Ctrl+Shift hide/show assistant · Ctrl+B sidebar · Ctrl+J panel · Ctrl+\` terminal · Ctrl+Shift+F search · Ctrl+, settings · Ctrl+W close tab · Shift+F5 stop.

---

## Architecture

```
electron/                      Main process (Node) — all privileged work
  main.ts                      Window (contextIsolation, sandbox, no nodeIntegration), lifecycle
  preload.ts                   contextBridge: explicit, named IPC channels only
  ipc/register.ts              IPC handlers with argument validation
  security/paths.ts            Workspace root + realpath containment for every path
  security/commands.ts         Command tokenizer, allowlist, destructive-command detection
  filesystem/fs-service.ts     Tree, read/write, search, debounced recursive watcher
  filesystem/zip.ts            Safe extraction (zip-slip, symlinks, size/ratio limits) and export
  terminal/runner.ts           Runtime detection, compile/run, stdout/stderr streaming, error parsing
  terminal/pty.ts              Interactive PTY shells (@lydell/node-pty)
  services/ollama.ts           Ollama REST client: tags, show/capabilities, chat stream, pull, ps, unload
  services/orchestrator.ts     The single AI pipeline: routing, vision pre-pass, agent loop, change sets
  services/context.ts          Request classification, system prompt, token-budgeted context assembly
  services/action-parser.ts    Model output → zod-validated FileAction objects
  services/file-actions.ts     Change sets: build, apply, reject, undo (originals stored)
  services/documents.ts        Attachments: images, PDF text (unpdf), text, ZIP; FTS5 chunk retrieval
  services/indexer.ts          Incremental project index (SQLite FTS5) + project memory
  services/knowledge.ts        Knowledge library: PDF/DOCX/text extraction, chunks, nomic embeddings, hybrid retrieval
  services/memory.ts           Conversations and messages
  services/db.ts               better-sqlite3 schema and settings
shared/                        Types, API contract and profile presets shared by both sides
src/                           React renderer (no Node access)
  store/app.ts                 Zustand store: workspace, tabs, runs, chat streaming, change sets
  editor/monaco.ts             Locally bundled Monaco + workers + Dark+/Light+ themes
  components/…                 TitleBar, ActivityBar, Explorer, Search, Run, Editor (tabs/diff),
                               BottomPanel (Terminal/Output/Problems/Debug), AISidebar, Chat, Settings
  components/ui                Shared primitives (Button, IconButton, inputs, Modal, ContextMenu…)
  styles.css                   Theme tokens (CSS variables) for Dark+ and Light+
tests/                         Unit tests (vitest)
scripts/                       E2E driver + scenarios, test PDF generator
```

### How a request flows

1. The renderer sends the message, attachment IDs and an **editor context** snapshot (active file, selection, open tabs, terminal tail, last run result).
2. The orchestrator **classifies** the request (general, code, reasoning, debug, vision, document, repository) and picks the model for that role. If a model isn't installed it falls back to another installed one, so you always get an answer.
3. **Images**: if the chosen model has the `vision` capability (checked via `/api/show`), the image goes straight to it. Otherwise the vision model first transcribes the screenshot (code, errors, line numbers), and that text goes to the coding model. The result is still one reply.
4. **Context** is assembled within a character budget derived from `num_ctx`. It includes project memory, the failing run, selection, the active file (windowed around the error line when large), attachment text (the whole document when small; otherwise the numbered question the user asked about plus FTS5 matches), relevant indexed code chunks, the file tree, terminal output and as much recent history as fits. Older turns are summarised.
5. The model streams its answer. If it asks to `read_file` or `search_files`, those read-only actions run automatically and the model continues, up to the agent-step limit.
6. Write actions (`create_file`, `edit_file`, `delete_file`, `rename_file`, `create_directory`, `run_command`) are validated with zod, checked against the workspace and the command allowlist, and stored as a **change set**. Nothing is written until you accept it, unless you turn on auto-apply, which never covers destructive actions.

### Model output protocol

```python file=src/primes.py
# the complete file
```

```action
{"type": "run_command", "command": "pip install flask"}
```

Fenced blocks tagged `file=` are full-file writes. `action` blocks hold JSON validated against the `FileAction` schemas. This works with any chat model; it doesn't depend on native tool calling.

### Security model

- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict CSP, no remote content, `window.open` denied, navigation locked, permission requests denied.
- Every file path from the renderer or the model is resolved through `realpath` and must stay inside the open workspace.
- AI commands are tokenized and spawned **without a shell**. Only allowlisted programs run; shell operators are rejected; destructive patterns are flagged; each command needs your explicit approval.
- ZIP import blocks `..` and absolute paths, symlinks, more than 20,000 entries, files over 200 MB, 1 GB in total and compression ratios above 200:1, and it counts bytes while streaming rather than trusting the archive header.
- Deletes go to the system trash.
- **Running code is powerful.** Programs run with your user account. Treat AI-generated or downloaded code as untrusted and review it before running.

### Data locations

Conversations, attachment metadata and extracted text, project index and memory, settings and change sets live in one SQLite file, `localcode.db`, in the app's data folder (Settings → About shows the path). Ollama stores model weights in its own folder.

---

## Known limitations

- Answer quality depends on the local model. A 3B–7B model sometimes skips the `file=` convention or writes imperfect code. Every write goes through review, and plain code blocks still have **Apply** and **Save as file** buttons.
- Vision needs a vision-capable model (e.g. `qwen2.5vl`). Without one the assistant says so and answers from the text only.
- Scanned PDFs (images only) have no extractable text, and there's no OCR. The app warns when a PDF has no text, and the knowledge library refuses such files.
- The library's relevance thresholds are tuned for `nomic-embed-text`. If you switch to another embedding model, re-embed the library (Knowledge → refresh), and retrieval may need tuning.
- Search covers every file in the workspace; replace works per file through Monaco (Ctrl+H). There's no workspace-wide replace.
- No step debugger: "Run and Debug" means running, capturing output and parsing errors.
- No split editor: one editor group with tabs. The AI diff view shows the two versions side by side when there's room.
- The macOS and Linux installers are configured but were only built and tested on Windows during development. Code signing and notarization aren't set up.
- GPU VRAM is exact only for NVIDIA (`nvidia-smi`). On other systems it's an estimate or unknown, and you can pick the profile manually.

See **TESTING.md** for the latest test run.
