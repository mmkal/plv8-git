/**
 * A custom serializer to unambiguously serialize json-able content to files.
 * It would also be possible to just use JSON.stringify, but this way string values
 * are a bit more human readable when using git diff tools.
 */

const prefixes = {
  string: `// type:string\n`,
  json: `// type:json\n`,
}

export const stringify = (val: unknown) => {
  if (typeof val === 'string') {
    return prefixes.string + val
  }
  if (Array.isArray(val) && typeof val[0] === 'number') {
    return prefixes.json + JSON.stringify(val)
  }
  return prefixes.json + JSON.stringify(val, null, 2)
}

export const parse = (str: string) => {
  if (str.startsWith(prefixes.string)) {
    return str.slice(prefixes.string.length)
  }
  if (str.startsWith(prefixes.json)) {
    return JSON.parse(str.slice(prefixes.json.length))
  }
  return str
}
