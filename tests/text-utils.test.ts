import { describe, expect, it } from 'vitest'
import { extractNumberedSection, ftsQuery } from '../electron/services/text-utils'
import { parseProblems } from '../electron/terminal/runner'

const doc = `Assignment 3
Question 1. Write a function that reverses a string.
Explain its complexity.
Question 2. Implement binary search on a sorted array and return the index.
Handle missing elements by returning -1.
Question 3. Build a stack using two queues.`

describe('document retrieval helpers', () => {
  it('extracts the section for "question 2"', () => {
    const s = extractNumberedSection(doc, 'Solve question 2 in Python', 2000)!
    expect(s).toContain('binary search')
    expect(s).toContain('returning -1')
    expect(s).not.toContain('two queues')
    expect(s).not.toContain('reverses a string')
  })
  it('supports "Q3" and numbered lists', () => {
    expect(extractNumberedSection(doc, 'explain Q3', 2000)).toContain('two queues')
    expect(extractNumberedSection('1) First task\n2) Second task here\n3) Third', 'do problem 2', 500)).toContain('Second task')
  })
  it('returns null when no number is asked for', () => {
    expect(extractNumberedSection(doc, 'summarise this', 500)).toBeNull()
  })
  it('builds an FTS query without stop words', () => {
    expect(ftsQuery('How do I fix the binary search?')).toBe('"fix" OR "binary" OR "search"')
    expect(ftsQuery('the a an')).toBeNull()
  })
})

describe('error parsing', () => {
  it('finds the failing line in a Python traceback', () => {
    const out = `Traceback (most recent call last):\n  File "C:\\ws\\app.py", line 7, in <module>\n    print(x)\nNameError: name 'x' is not defined`
    expect(parseProblems(out, 'python', 'C:\\ws\\app.py')).toEqual([
      { file: 'C:\\ws\\app.py', line: 7, column: undefined, message: "NameError: name 'x' is not defined", severity: 'error' }
    ])
  })
  it('parses Python syntax errors', () => {
    const out = `  File "/ws/a.py", line 3\n    def f(\n         ^\nSyntaxError: '(' was never closed`
    expect(parseProblems(out, 'python', '/ws/a.py')[0]).toMatchObject({ line: 3, message: "SyntaxError: '(' was never closed" })
  })
  it('parses g++ diagnostics', () => {
    const out = `main.cpp:5:3: error: expected ';' before 'return'\nmain.cpp:9:1: warning: unused variable`
    const p = parseProblems(out, 'cpp', 'main.cpp')
    expect(p).toHaveLength(2)
    expect(p[0]).toMatchObject({ line: 5, column: 3, severity: 'error' })
    expect(p[1].severity).toBe('warning')
  })
  it('parses javac errors', () => {
    expect(parseProblems('Main.java:4: error: cannot find symbol', 'java', 'Main.java')[0]).toMatchObject({ line: 4 })
  })
  it('parses Node stack traces for the run file', () => {
    const out = `C:\\ws\\x.js:3\n  foo()\n  ^\nReferenceError: foo is not defined\n    at Object.<anonymous> (C:\\ws\\x.js:3:3)`
    expect(parseProblems(out, 'javascript', 'C:\\ws\\x.js')[0]).toMatchObject({ line: 3, message: 'ReferenceError: foo is not defined' })
  })
})
