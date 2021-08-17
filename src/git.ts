import * as memfs from 'memfs'
import * as path from 'path'
import * as git from 'isomorphic-git'
import * as serializer from './serializer'
import {PG_Vars} from './pg-types'
import {setupMemfs} from './fs'

function writeGitFiles(gitFiles: any, fs: memfs.IFs) {
  if (!gitFiles) {
    throw new Error(`Expected gitFiles as object, got ${gitFiles}`)
  }
  Object.keys(gitFiles).map(filepath => {
    fs.mkdirSync(path.dirname(filepath), {recursive: true})
    fs.writeFileSync(filepath, Buffer.from(gitFiles[filepath]))
  })
}

/**
 * Implementation for a trigger function which takes a row as a hashmap, and returns
 * a new value with a `git` json property, representing the `.git` folder of a repo.
 * Note - a different column name can be passed to `TG_ARGV`.
 */
export const rowToRepo = ({OLD, NEW, ...pg}: PG_Vars) => {
  const {fs, vol} = setupMemfs()
  const repo = {fs, dir: '/repo'}
  const repoColumn = pg.TG_ARGV[0] || 'git'
  if (pg.TG_ARGV[0] && repoColumn.match(/\W/)) {
    throw new Error(`Invalid column name ${repoColumn}`)
  }

  const setupGitFolder = () => {
    if (pg.TG_OP === 'INSERT') {
      return git.init({...repo, defaultBranch: 'main'})
    }

    if (!OLD![repoColumn]) {
      throw new Error(`expected ${repoColumn} column on ${pg.TG_OP} old value: ${JSON.stringify(OLD, null, 2)}.`)
    }

    return writeGitFiles(OLD![repoColumn], fs)
  }

  const gitParams = NEW?.[repoColumn] || {}

  const commitMessage = `${pg.TG_NAME}: ${pg.TG_WHEN} ${pg.TG_OP} ${pg.TG_LEVEL} on ${pg.TG_TABLE_SCHEMA}.${pg.TG_TABLE_NAME}`.trim()

  return Promise.resolve()
    .then(setupGitFolder)
    .then(() => {
      if (!NEW) return
      Object.entries(NEW)
        .filter(([k]) => k !== repoColumn)
        .forEach(([k, val]) => {
          const content = serializer.stringify(val)
          const filepath = `${repo.dir}/${k}`
          fs.writeFileSync(filepath, content, {encoding: 'utf8'})
        })
      return Promise.resolve()
        .then(() => git.add({...repo, filepath: '.'}))
        .then(() =>
          git.commit({
            ...repo,
            message: [gitParams.commit?.message, commitMessage].filter(Boolean).join('\n\n'),
            author: {
              name: gitParams.commit?.author?.name || getSetting('user.name') || 'pguser',
              email: gitParams.commit?.author?.email || getSetting('user.email') || 'pguser@pg.com',
            },
          }),
        )
        .then(commit => {
          const allTags: string[] = [
            ...(getSetting('tags.tags')?.split(':') || []), // colon separated tags from config
            ...(gitParams.tags || []),
          ].filter(Boolean)
          return Promise.all(
            allTags.map((tag: string) => {
              return git.tag({...repo, ref: tag, object: commit})
            }),
          )
        })
    })
    .then(() => {
      const files: Record<string, number[]> = {}
      // memfs has a toJSON method, but we can't use it directly because it tries to coerce all files into utf8 strings. Take advantage of its directory-walking though.
      const volJson = vol.toJSON(repo.dir + '/.git')
      const paths = Object.keys(volJson).filter(p => volJson[p] !== null)
      paths.forEach(p => {
        files[p] = Array.from(fs.readFileSync(p) as Buffer)
      })

      return files
    })
    .then(repo => ({
      ...NEW,
      [repoColumn]: repo,
    }))
}

declare const plv8: {
  execute(sql: string, args?: unknown[]): Record<string, unknown>[]
}
const getSetting = (name: string) => {
  // https://www.postgresql.org/docs/9.4/functions-admin.html
  const [{git_get_config}] = plv8.execute('select git_get_config($1)', [name])
  return git_get_config as string | null
}

type TreeInfo = {type: string; content: string; oid: string}
type WalkResult = {filepath: string; ChildInfo: TreeInfo; ParentInfo?: TreeInfo}

/**
 * When passed a json object representing the `.git` folder of a repo, returns a list
 * of changes made to corresponding row. Optionally, pass `depth` to limit how far back
 * in time to fetch history for.
 */
export const gitLog = (gitRepoJson: object, depth?: number) => {
  const {fs} = setupMemfs()
  const repo = {fs, dir: '/repo'}

  return Promise.resolve()
    .then(() => writeGitFiles(gitRepoJson, fs))
    .then(() => git.log({...repo, depth}))
    .then(log => {
      return Promise.all(
        log.map(e => {
          return git
            .walk({
              ...repo,
              trees: [e.oid, e.commit.parent[0]].filter(Boolean).map(ref => git.TREE({ref})),
              map: (filepath, entries) => {
                const [Child, Parent] = entries || []
                return Promise.all([resolveTree(Child), Parent && resolveTree(Parent)]).then(
                  ([ChildInfo, ParentInfo]): WalkResult => ({filepath, ChildInfo, ParentInfo} as WalkResult),
                )
              },
            })
            .then((results: WalkResult[]) => {
              return git.listTags({...repo}).then(tags => {
                return {results, tags}
              })
            })
            .then(({results, tags}) => ({
              message: e.commit.message.trim(),
              author: `${e.commit.author.name} (${e.commit.author.email})`,
              timestamp: new Date(e.commit.author.timestamp * 1000).toISOString(),
              oid: e.oid,
              tags,
              changes: results
                .filter(
                  r => r.ChildInfo?.type === 'blob' && r.filepath !== '.' && r.ChildInfo.oid !== r.ParentInfo?.oid,
                )
                .map(r => ({
                  field: r.filepath,
                  new: serializer.parse(r.ChildInfo.content),
                  old: r.ParentInfo && serializer.parse(r.ParentInfo.content),
                })),
            }))
        }),
      )
    })
}

/**
 * Resolves a git ref into a dictionary of values, which can be passed to `INSERT` or `UPDATE` operations
 * @param gitRepoJson a json object representing the `.git` folder of a repo
 * @param ref a git ref string
 */
export const gitResolve = (gitRepoJson: object, ref: string) => {
  const {fs} = setupMemfs()
  const repo = {fs, dir: '/repo'}

  return Promise.resolve()
    .then(() => writeGitFiles(gitRepoJson, fs))
    .then(() =>
      git.walk({
        ...repo,
        trees: [git.TREE({ref})],
        map: (filepath, entries) => resolveTree(entries![0])!.then(tree => ({filepath, tree})),
      }),
    )
    .then((results: Array<{filepath: string; tree: ResolvedTree}>) =>
      results
        .filter(r => r.tree.type === 'blob' && r.filepath !== '.')
        .reduce(
          (dict, next) => Object.assign(dict, {[next.filepath]: serializer.parse(next.tree.content)}),
          {} as Record<string, any>,
        ),
    )
}

/**
 * for some reason A.content() converts from a buffer to {"0": 100, "1": 101} format.
 * Object.values(...) converts back to a number array. Wasteful, but works for now.
 */
const btos = (obj: any) => Buffer.from(Object.values<number>(obj || {})).toString()

type PromiseResult<P> = P extends Promise<infer X> ? X : never
type ResolvedTree = PromiseResult<ReturnType<typeof resolveTree>>
/** gets the type, content and oid for a `WalkerEntry` */
const resolveTree = (tree: git.WalkerEntry | null) => {
  const promises = tree && [tree.type(), tree.content().then(btos), tree.oid()]
  return promises && Promise.all(promises).then(([type, content, oid]) => ({type, content, oid}))
}
