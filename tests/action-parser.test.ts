import { describe, expect, it } from 'vitest'
import { parseActions } from '../electron/services/action-parser'

describe('parseActions', () => {
  it('reads file= fenced blocks as full-file writes', () => {
    const text = 'Here you go:\n\n```python file=src/primes.py\nprint(2)\n```\n\nRun it with python.'
    const { actions } = parseActions(text)
    expect(actions).toEqual([{ type: 'create_file', path: 'src/primes.py', content: 'print(2)\n' }])
  })
  it('accepts path= and title="..." variants and Windows separators', () => {
    const { actions } = parseActions('```js path=web\\app.js\nx()\n```\n```css title="web/style.css"\nbody{}\n```')
    expect(actions.map((a) => ('path' in a ? a.path : ''))).toEqual(['web/app.js', 'web/style.css'])
  })
  it('uses an explicit "File:" header above a block', () => {
    const { actions } = parseActions('**File: app.py**\n```python\nprint(1)\n```')
    expect(actions[0]).toMatchObject({ type: 'create_file', path: 'app.py' })
  })
  it('reads file names from headings like "### Header File: `tree.h`"', () => {
    const text = 'Sure!\n\n### Header File: `tree.h`\n```c\n#ifndef TREE_H\n#define TREE_H\n#endif\n```\n\n### Source File: `tree.c`\n```c\n#include "tree.h"\n```\n\n**main.c**\n```c\nint main(){return 0;}\n```'
    const { actions } = parseActions(text)
    expect(actions.map((a) => ('path' in a ? a.path : ''))).toEqual(['tree.h', 'tree.c', 'main.c'])
  })
  it('reads "// file=path" first-line comments and strips them', () => {
    const text = '```c\n// file=include/expression_tree.h\n#ifndef X\n#endif\n```\n```python\n# filename: app.py\nprint(1)\n```'
    const { actions } = parseActions(text)
    expect(actions).toEqual([
      { type: 'create_file', path: 'include/expression_tree.h', content: '#ifndef X\n#endif\n' },
      { type: 'create_file', path: 'app.py', content: 'print(1)\n' }
    ])
  })
  it('does not treat #include as a file name', () => {
    expect(parseActions('```c\n#include <stdio.h>\nint main(){}\n```').actions).toEqual([])
  })
  it('ignores plain example code blocks', () => {
    const { actions } = parseActions('Example:\n```python\nprint(1)\n```')
    expect(actions).toEqual([])
  })
  it('validates action JSON blocks', () => {
    const text = '```action\n[{"type":"delete_file","path":"old.py"},{"type":"run_command","command":"python app.py"},{"type":"explode"}]\n```'
    const { actions, errors } = parseActions(text)
    expect(actions).toEqual([
      { type: 'delete_file', path: 'old.py' },
      { type: 'run_command', command: 'python app.py' }
    ])
    expect(errors.length).toBe(1)
  })
  it('parses read-only agent actions', () => {
    const { actions } = parseActions('```action\n{"type":"read_file","path":"src/main.py"}\n```')
    expect(actions).toEqual([{ type: 'read_file', path: 'src/main.py' }])
  })
  it('reports malformed JSON instead of throwing', () => {
    const { actions, errors } = parseActions('```action\n{not json}\n```')
    expect(actions).toEqual([])
    expect(errors[0]).toMatch(/Could not parse/)
  })
})
