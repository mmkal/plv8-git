export const memoizeAsync = <A extends any[], T>(fn: (...args: A) => Promise<T>): ((...args: A) => Promise<T>) => {
  const cache = new Map<string, T>()
  return (...args: A) => {
    const key = JSON.stringify(args)
    if (cache.has(key)) {
      return Promise.resolve(cache.get(key)!)
    }

    return fn(...args).then(result => {
      cache.set(key, result)
      return result
    })
  }
}
