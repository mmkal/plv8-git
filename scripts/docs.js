const path = require('path')
const fs = require('fs')

/** @type {import('eslint-plugin-codegen').Preset<{}>} */
module.exports = params => {
  const testfile = path.join(path.dirname(params.meta.filename), 'test/walkthrough.test.ts')
  const content = fs.readFileSync(testfile).toString()
  const lines = content.split('\n')
  const testName = 'walkthrough'
  const start = lines.findIndex(line => line.startsWith(`test('${testName}'`)) + 1
  if (start === 0) {
    throw new Error(`Couldn't find test ${testName} in ${testfile}`)
  }
  const end = lines.findIndex((line, i) => i > start && line.startsWith('})'))

  let codeBlockLinePrefix = 'CODE_BLOCK_LINE:'

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
            .map(line => line.replace(/^  /, codeBlockLinePrefix))
            .join('\n')
    })
    .join('`')
    .split('\n')
    .filter(line => !line.startsWith('// todo') && !line.startsWith('// TODO'))
    .map((line, i) => {
      if (line.endsWith('=> {')) {
        codeBlockLinePrefix += '  '
        return null
      }
      if (line.endsWith('})')) {
        codeBlockLinePrefix = codeBlockLinePrefix.replace(/  $/, '')
        return null
      }
      if (line.includes('sql`')) return '```sql'
      if (line.includes('.toMatchInlineSnapshot(`')) return '```json'
      if (line.trim().endsWith('`)')) return '```'
      if (line.startsWith('// ')) return line.replace('// ', '')
      if (line.startsWith(codeBlockLinePrefix)) return line.replace(codeBlockLinePrefix, '')
      if (line.replace(/\r/, '') !== '') {
        throw new Error(
          `
            Unexpected content in test ${testName} from ${testfile}:${i}
            The test is used to generate documentation, so should only contain sql queries and inline snapshots.
            Use a different test for anything else!
            Found content:

            ${JSON.stringify(line)}
          `.replace(/^ +/g, ''),
        )
      }
      return line
    })
    .filter(line => line !== null)
    .join('\n')
}
