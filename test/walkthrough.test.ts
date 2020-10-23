import {createPool, sql} from 'slonik'
import {readFileSync} from 'fs'
import * as path from 'path'

// NOTE! This file is used to auto-generate the readme.
// Tests that shouldn't be part of the walkthrough documentation should go elsewhere.

const connectionString = `postgresql://postgres:postgres@localhost:5435/postgres`

const client = createPool(connectionString, {
  idleTimeout: 1,
  typeParsers: [{name: 'timestamptz', parse: v => fuzzifyDate(v).toISOString()}],
})

// stupid way of getting stable date results
const start = new Date()
const fuzzifyDate = (s: string) => {
  const real = new Date(s)
  return real.getTime() - start.getTime() < 5000 ? new Date('2020-10-23T12:00Z') : real
}

beforeAll(async () => {
  // todo: use a different schema than public, then just drop and recreate the whole schema
  // set search path doesn't seem to do the trick, may require swapping out the pool or something
  await client.query(sql`
    drop trigger if exists test_table_track_deletion_trigger on test_table;
    drop function if exists test_table_track_deletion;
    drop table if exists deleted_history;
    drop trigger if exists test_table_git_track_trigger on test_table;
    drop table if exists test_table;

    create extension if not exists plv8;

    drop function if exists git_track cascade;
    drop function if exists git_log(json, int) cascade;
    drop function if exists git_log cascade;
  `)

  await client.query({
    type: 'SLONIK_TOKEN_SQL',
    sql: readFileSync(path.join(__dirname, '../queries/create-git-functions.sql')).toString(),
    values: [],
  })

  console.log('plv8 version', await client.oneFirst(sql`select plv8_version()`))
})

afterAll(async () => {
  await client.end()
})

const readableJson = (o: unknown) => {
  /**
   * very advanced algorithm for determining if a key-value pair is worth pretty-printing. if not,
   * we're better off putting it on a single line so it doesn't take up too much space
   */
  const isByteArray = (k: string, v: unknown) => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'number')

  const isGitRepoJson = (k: string, v: unknown): v is Record<string, string> =>
    k === 'git' && v && typeof v === 'object'

  const markers: any = {}
  const replacer = (k: string, v: unknown): any => {
    if (isByteArray(k, v)) {
      return '[byte array]'
    }
    if (isGitRepoJson(k, v)) {
      const copy: typeof v = {}
      Object.entries(v).forEach((e, i) => {
        copy[e[0].replace(/\.git(\/\w+)+/, `.git/path/to/object${i}`)] = '[byte array]'
      })
      return copy
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

expect.addSnapshotSerializer({
  test: () => true,
  print: val => readableJson(val),
})

test('walkthrough', async () => {
  // ### Tracking history

  // `git_track` is a trigger function that can be added to any table, with a `json` column, default-named `git`:

  await client.query(sql`
    create table test_table(
      id int,
      text text,
      git json
    );
    
    create trigger test_table_git_track_trigger
      before insert or update
      on test_table for each row
      execute procedure git_track();
  `)

  // Now, whenever rows are inserted or updated into the `test_table` table, the `git` column will automatically be managed as a serialisation of the `.git` folder of an ephemeral git repo. All you need to do is `insert`/`update` as normal:

  await client.query(sql`
    insert into test_table(id, text)
    values(1, 'initial content');

    update test_table
    set text = 'updated content'
    where id = 1;
  `)

  // There's still just a single row in the `test_table` table, but the full history of it is tracked in the `git` column. The `git_log` function can be used to access the change history:

  let result = await client.many(sql`
    select git_log(git)
    from test_table
    where id = 1
  `)

  // This query will return:

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "git_log": [
          {
            "message": "test_table_git_track_trigger: BEFORE UPDATE ROW on public.test_table",
            "author": "pguser (pguser@pg.com)",
            "timestamp": "2020-10-23T12:00:00.000Z",
            "changes": [
              {
                "field": "text",
                "new": "updated content",
                "old": "initial content"
              }
            ]
          },
          {
            "message": "test_table_git_track_trigger: BEFORE INSERT ROW on public.test_table",
            "author": "pguser (pguser@pg.com)",
            "timestamp": "2020-10-23T12:00:00.000Z",
            "changes": [
              {
                "field": "id",
                "new": 1
              },
              {
                "field": "text",
                "new": "initial content"
              }
            ]
          }
        ]
      }
    ]
  `)

  // i.e. you can see the row's full history, in human- and machine-readable form, straight from the table.

  // To use existing git clients to get rich visual diffs, etc., you can simply pull the `git` field for a given row, and convert it into real files:

  result = await client.many(sql`
    select git from test_table where id = 1
  `)

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "git": {
          "/repo/.git/path/to/object0": "[byte array]",
          "/repo/.git/path/to/object1": "[byte array]",
          "/repo/.git/path/to/object2": "[byte array]",
          "/repo/.git/path/to/object3": "[byte array]",
          "/repo/.git/path/to/object4": "[byte array]",
          "/repo/.git/path/to/object5": "[byte array]",
          "/repo/.git/path/to/object6": "[byte array]",
          "/repo/.git/path/to/object7": "[byte array]",
          "/repo/.git/path/to/object8": "[byte array]",
          "/repo/.git/path/to/object9": "[byte array]",
          "/repo/.git/path/to/object10": "[byte array]"
        }
      }
    ]
  `)

  // This will return a json-formatted object, with keys corresponding to file system paths, and byte-array values as contents. Write them to disk using the CLI tool provided with this package:

  // ```bash
  // GIT=$(psql -qAt -c "select git from test_table where id = 1")
  // node_modules/.bin/plv8-git write --input "$GIT" --output path/to/git/dir
  // ```

  // `path/to/git/dir` will now be a valid git repository, with one file corresponding to each column in `test_table`. You can `cd` into it, and run commands like `git log`, or use your favourite git UI to inspect the history in as much detail as you'd like.

  // ### Deletions

  // You can also take advantage of the `git` column to track deletions, by adding a delete hook:

  await client.query(sql`
    create table deleted_history(
      schemaname name,
      tablename name,
      identifier jsonb,
      deleted_at timestamptz,
      git json
    );

    create function test_table_track_deletion() returns trigger as
    $$
      begin
        insert into deleted_history(schemaname, tablename, identifier, deleted_at, git)
        values ('public', 'test_table', jsonb_build_object('id', OLD.id), now(), OLD.git);

        return OLD;
      end
    $$
    language plpgsql;

    create trigger test_table_track_deletion_trigger
      before delete
      on test_table for each row
      execute procedure test_table_track_deletion();
  `)

  // You can now perform deletions as normal and they'll be automatically tracked in `deleted_history`:

  await client.query(sql`
    delete from test_table
    where id = 1
  `)

  // The `deleted_history` table can be queried in the same was as the other tables:

  result = await client.any(sql`
    select *
    from deleted_history
    where identifier->>'id' = '1'
  `)

  // This will return something like:

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "schemaname": "public",
        "tablename": "test_table",
        "identifier": {
          "id": 1
        },
        "deleted_at": "2020-10-23T12:00:00.000Z",
        "git": {
          "/repo/.git/path/to/object0": "[byte array]",
          "/repo/.git/path/to/object1": "[byte array]",
          "/repo/.git/path/to/object2": "[byte array]",
          "/repo/.git/path/to/object3": "[byte array]",
          "/repo/.git/path/to/object4": "[byte array]",
          "/repo/.git/path/to/object5": "[byte array]",
          "/repo/.git/path/to/object6": "[byte array]",
          "/repo/.git/path/to/object7": "[byte array]",
          "/repo/.git/path/to/object8": "[byte array]",
          "/repo/.git/path/to/object9": "[byte array]",
          "/repo/.git/path/to/object10": "[byte array]"
        }
      }
    ]
  `)

  // You can use `git_log` again to get a readable history:

  result = await client.any(sql`
    select git_log(git)
    from deleted_history
    where identifier->>'id' = '1'
  `)

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "git_log": [
          {
            "message": "test_table_git_track_trigger: BEFORE UPDATE ROW on public.test_table",
            "author": "pguser (pguser@pg.com)",
            "timestamp": "2020-10-23T12:00:00.000Z",
            "changes": [
              {
                "field": "text",
                "new": "updated content",
                "old": "initial content"
              }
            ]
          },
          {
            "message": "test_table_git_track_trigger: BEFORE INSERT ROW on public.test_table",
            "author": "pguser (pguser@pg.com)",
            "timestamp": "2020-10-23T12:00:00.000Z",
            "changes": [
              {
                "field": "id",
                "new": 1
              },
              {
                "field": "text",
                "new": "initial content"
              }
            ]
          }
        ]
      }
    ]
  `)

  // In this example, `deleted_history` is generic enough that it could be the "history" table for several other relations, since it uses columns `schemaname` and `tablename`, and `identifier` as the flexible `JSONB` data type to allow for different types of primary key. This avoids the overhead of needing a new `_history` table for every relation created - all the data, including history, is captured in the `git` column. The `identifier` column is only used for lookups.

  // ### Configuraton

  // You can pass a custom commit message and author by pre-loading the `git` property with `commit` details, which can include a commit message and user info:

  await client.query(sql`
    insert into test_table(
      id,
      text,
      git
    )
    values(
      2,
      'a value',
      '{ "commit": { "message": "some custom message", "author": { "name": "Alice", "email": "alice@gmail.com" } } }'
    )
  `)

  result = await client.many(sql`
    select git_log(git)
    from test_table
    where id = 2
  `)

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "git_log": [
          {
            "message": "some custom message\\n\\ntest_table_git_track_trigger: BEFORE INSERT ROW on public.test_table",
            "author": "Alice (alice@gmail.com)",
            "timestamp": "2020-10-23T12:00:00.000Z",
            "changes": [
              {
                "field": "id",
                "new": 2
              },
              {
                "field": "text",
                "new": "a value"
              }
            ]
          }
        ]
      }
    ]
  `)

  // `git_log` also accepts a `depth` parameter to limit the amount of history that is fetched:

  await client.query(sql`
    update test_table
    set text = 'a new value',
        git = '{ "commit": { "message": "Changed because the previous value was out-of-date"  } }'
    where id = 2
  `)

  result = await client.many(sql`
    select git_log(git, depth := 1)
    from test_table
    where id = 2
  `)

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "git_log": [
          {
            "message": "Changed because the previous value was out-of-date\\n\\ntest_table_git_track_trigger: BEFORE UPDATE ROW on public.test_table",
            "author": "pguser (pguser@pg.com)",
            "timestamp": "2020-10-23T12:00:00.000Z",
            "changes": [
              {
                "field": "text",
                "new": "a new value",
                "old": "a value"
              }
            ]
          }
        ]
      }
    ]
  `)

  // By setting `depth := 1`, only the most recent change is returned.
})
