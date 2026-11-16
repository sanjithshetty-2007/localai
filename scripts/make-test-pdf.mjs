// Writes a small multi-page PDF assignment for testing (no dependencies).
// Usage: node scripts/make-test-pdf.mjs out.pdf
import fs from 'node:fs'

// Optional 2nd argument: a JSON file with an array of pages (each an array of lines).
const pages = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : [
  ['Data Structures Assignment 2', '', 'Question 1. Write a function that reverses a linked list.', 'Explain the time complexity of your solution.'],
  [
    'Question 2. Write a Python function is_palindrome(s) that returns True',
    'if the string s reads the same forwards and backwards, ignoring case',
    'and non-alphanumeric characters. Include three test cases.',
    '',
    'Question 3. Implement a queue using two stacks.'
  ]
]

const objs = []
const add = (s) => objs.push(s) - 1 + 1
const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
const pageIds = []
const pagesId = objs.length + pages.length * 2 + 1
for (const lines of pages) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => '\\' + c)
  const stream = 'BT /F1 12 Tf 60 760 Td 16 TL ' + lines.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET'
  const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`))
}
add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

let out = '%PDF-1.4\n'
const offsets = []
objs.forEach((o, i) => {
  offsets.push(out.length)
  out += `${i + 1} 0 obj\n${o}\nendobj\n`
})
const xref = out.length
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
fs.writeFileSync(process.argv[2] ?? 'assignment.pdf', out, 'latin1')
