test('queries exports', async () => {
  expect(require('../queries').gitFunctionsPath).toEqual(expect.any(String))
  expect(require('../queries').getGitFunctionsSql()).toEqual(expect.any(String))
  expect(await require('../queries').getGitFunctionsSqlAsync()).toEqual(expect.any(String))
})
