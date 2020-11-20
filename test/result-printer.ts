import {createHash} from 'crypto'

const start = new Date()
/** stupid way of getting stable date results */
export const fuzzifyDate = (s: string) => {
  const real = new Date(s)
  return real.getTime() - start.getTime() < 5000 ? new Date('2000-12-25T12:00Z') : real
}

const gitRepoHashes: string[] = []
/**
 * JSON.stringify with a replacer that returns stable values for byte arrays, oids, git repo json representations and timestamps.
 * Useful for jest snapshot testing - the result is pretty human readable and stays the same across runs.
 */
export const readableJson = (o: unknown) => {
  /**
   * very advanced algorithm for determining if a key-value pair is worth pretty-printing. if not,
   * we're better off putting it on a single line so it doesn't take up too much space
   */
  const isByteArray = (k: string, v: unknown) => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'number')

  const isGitRepoJson = (k: string, v: unknown): v is Record<string, string> =>
    k === 'git' && Boolean(v) && typeof v === 'object'

  const markers: any = {}
  const replacer = (k: string, v: unknown): any => {
    if (isByteArray(k, v)) {
      return '[byte array]'
    }
    if (isGitRepoJson(k, v)) {
      const actualJson = JSON.stringify(v)
      gitRepoHashes.push(actualJson)
      const copy: typeof v = {}
      Object.keys(v).forEach((oldKey, i) => {
        // replace the actual git object paths with fake ones. hashing based on index
        const newKey = oldKey.replace(/\/objects\/(.*)/, () => {
          const hash = createHash('sha256')
            .update(`${i}.${gitRepoHashes.indexOf(actualJson)}`)
            .digest('hex')
          return `/objects/${hash.slice(0, 2)}/${hash.slice(2, 40)}`
        })
        copy[newKey] = '[byte array]'
      })
      return copy
    }
    if (k === 'oid' && typeof v === 'string') {
      return '[oid]'
    }
    if (k === 'timestamp' && typeof v === 'string') {
      return fuzzifyDate(v).toISOString()
    }
    return v
  }

  let json = JSON.stringify(o, replacer, 2)
  Object.keys(markers).forEach(id => {
    json = json.replace(id, markers[id])
  })

  return json
}
