const codegen = require('eslint-plugin-codegen')

module.exports = params => {
  const defaultDocsFromTest = codegen.presets.markdownFromTests({
    meta: params.meta,
    options: {
      source: 'test/main.test.ts',
    },
  })

  return defaultDocsFromTest
    .split('\n')
    .filter(line => line.includes('//') || !line.includes('```'))
    .join('\n')
    .split('`')
    .map((section, i) =>
      i % 2 === 0
        ? section
        : section
            .split('\n')
            .map(line => line.replace(/^  /, ''))
            .join('\n'),
    )
    .join('`')
    .split('\n')
    .map(line => {
      if (line.includes('sql`')) return '```sql'
      if (line.includes('.toMatchInlineSnapshot(`')) return '```json'
      if (line.trim().endsWith('`)')) return '```'
      if (line.startsWith('// ')) return line.replace('// ', '')
      return line
    })
    .join('\n')
}
