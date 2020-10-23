const path = require('path')
const fs = require('fs')

/** @type {import('eslint-plugin-codegen').Preset<{}>} */
module.exports = params => {
  const testfile = path.join(path.dirname(params.meta.filename), 'test/main.test.ts')
  const content = fs.readFileSync(testfile).toString()
  const lines = content.split('\n')
  const testName = 'walkthrough'
  const start = lines.findIndex(line => line.startsWith(`test('${testName}'`)) + 1
  if (start === 0) {
    throw new Error(`Couldn't find test ${testName} in ${testfile}`)
  }
  const end = lines.findIndex((line, i) => i > start && line.startsWith('})'))

  return lines
    .slice(start, end)
    .map(line => line.replace(/^  /, ''))
    .join('\n')
    .split('`')
    .map((section, i) => {
      return i % 2 === 0
        ? section
        : section
            .split('\n')
            .map(line => line.replace(/^  /, ''))
            .join('\n')
    })
    .join('`')
    .split('\n')
    .map(line => {
      if (line.includes('sql`')) return '```sql'
      if (line.includes('.toMatchInlineSnapshot(`')) return '```json'
      if (line.trim().endsWith('`)')) return '```'
      if (line.startsWith('// ')) return line.replace('// ', '')
      if (line.includes(`await`) || line.includes(`expect(`) || line.includes(`toMatchInlineSnapshot`)) {
        throw new Error(`Unexpected code in test ${testName} from ${testfile}: ${line}`)
      }
      return line
    })
    .join('\n')
}
