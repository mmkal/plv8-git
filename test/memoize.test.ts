import {memoizeAsync} from '../src/memoize'

test('memoize', async () => {
  const mock = jest.fn(async () => Math.random())

  const memoized = memoizeAsync(mock)

  const first = await memoized()
  const second = await memoized()

  expect([first, second]).toEqual([expect.any(Number), expect.any(Number)])
  expect(mock).toHaveBeenCalledTimes(1)
  expect(second).toEqual(first)
})
