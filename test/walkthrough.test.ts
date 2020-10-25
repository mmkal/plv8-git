import {createPool, sql} from 'slonik'
import {readFileSync} from 'fs'
import * as path from 'path'
import {createHash} from 'crypto'
import {fuzzifyDate, readableJson} from './result-printer'

// NOTE! This file is used to auto-generate the readme.
// Tests that shouldn't be part of the walkthrough documentation should go elsewhere.

const connectionString = `postgresql://postgres:postgres@localhost:5435/postgres`

const client = createPool(connectionString, {
  idleTimeout: 1,
  typeParsers: [{name: 'timestamptz', parse: v => fuzzifyDate(v).toISOString()}],
})
let result: any

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

  result = await client.many(sql`
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
            "timestamp": "2000-12-25T12:00:00.000Z",
            "oid": "[oid]",
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
            "timestamp": "2000-12-25T12:00:00.000Z",
            "oid": "[oid]",
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
          "/repo/.git/objects/8a/ed642bf5118b9d3c859bd4be35ecac75b6e873": "[byte array]",
          "/repo/.git/objects/d0/ff5974b6aa52cf562bea5921840c032a860a91": "[byte array]",
          "/repo/.git/objects/d8/4bdb34d4eeef4034d77e5403f850e35bc4a51b": "[byte array]",
          "/repo/.git/objects/a4/16ea84421fa7e1351582da48235bac88380a33": "[byte array]",
          "/repo/.git/objects/fb/d04e1aae9ce0b11a8946e2c9ac2619f7428a64": "[byte array]",
          "/repo/.git/objects/a1/9a1584344c1f3783bff51524a5a4b86f2cc093": "[byte array]",
          "/repo/.git/objects/8a/b31b5afaea56114427e1f01b81d001b079a0f5": "[byte array]",
          "/repo/.git/refs/heads/main": "[byte array]",
          "/repo/.git/config": "[byte array]",
          "/repo/.git/HEAD": "[byte array]",
          "/repo/.git/index": "[byte array]"
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

  result = await client.one(sql`
    select *
    from deleted_history
    where identifier->>'id' = '1'
  `)

  // This will return something like:

  expect(result).toMatchInlineSnapshot(`
    {
      "schemaname": "public",
      "tablename": "test_table",
      "identifier": {
        "id": 1
      },
      "deleted_at": "2000-12-25T12:00:00.000Z",
      "git": {
        "/repo/.git/objects/8a/ed642bf5118b9d3c859bd4be35ecac75b6e873": "[byte array]",
        "/repo/.git/objects/d0/ff5974b6aa52cf562bea5921840c032a860a91": "[byte array]",
        "/repo/.git/objects/d8/4bdb34d4eeef4034d77e5403f850e35bc4a51b": "[byte array]",
        "/repo/.git/objects/a4/16ea84421fa7e1351582da48235bac88380a33": "[byte array]",
        "/repo/.git/objects/fb/d04e1aae9ce0b11a8946e2c9ac2619f7428a64": "[byte array]",
        "/repo/.git/objects/a1/9a1584344c1f3783bff51524a5a4b86f2cc093": "[byte array]",
        "/repo/.git/objects/8a/b31b5afaea56114427e1f01b81d001b079a0f5": "[byte array]",
        "/repo/.git/refs/heads/main": "[byte array]",
        "/repo/.git/config": "[byte array]",
        "/repo/.git/HEAD": "[byte array]",
        "/repo/.git/index": "[byte array]"
      }
    }
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
            "timestamp": "2000-12-25T12:00:00.000Z",
            "oid": "[oid]",
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
            "timestamp": "2000-12-25T12:00:00.000Z",
            "oid": "[oid]",
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
      'original value set by alice',
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
            "timestamp": "2000-12-25T12:00:00.000Z",
            "oid": "[oid]",
            "changes": [
              {
                "field": "id",
                "new": 2
              },
              {
                "field": "text",
                "new": "original value set by alice"
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
    set text = 'a new value set by admin',
        git = '{ "commit": { "message": "Changed because the previous value was out-of-date"  } }'
    where id = 2
  `)

  result = await client.many(sql`
    select git_log(git, depth := 2)
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
            "timestamp": "2000-12-25T12:00:00.000Z",
            "oid": "[oid]",
            "changes": [
              {
                "field": "text",
                "new": "a new value set by admin",
                "old": "original value set by alice"
              }
            ]
          },
          {
            "message": "some custom message\\n\\ntest_table_git_track_trigger: BEFORE INSERT ROW on public.test_table",
            "author": "Alice (alice@gmail.com)",
            "timestamp": "2000-12-25T12:00:00.000Z",
            "oid": "[oid]",
            "changes": [
              {
                "field": "id",
                "new": 2
              },
              {
                "field": "text",
                "new": "original value set by alice"
              }
            ]
          }
        ]
      }
    ]
  `)

  // By setting `depth := 1`, only the most recent change is returned.

  // ### Restoring previous versions

  // `git_resolve` gives you a json representation of a prior version of a row, which can be used for backup and restore. The first argument is a `git` json value, the second value is a valid git ref string.

  // Combine it with `git_log` to get a previous version - the below query uses `->1->'oid'` to get the oid from the second item in the log array:

  result = await client.many(sql`
    select git_resolve(git, git_log(git)->1->>'oid')
    from test_table
    where id = 2
  `)

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "git_resolve": {
          "id": 2,
          "text": "original value set by alice"
        }
      }
    ]
  `)

  // This can be used in an update query to revert a change:

  result = await client.one(sql`
    update test_table set (id, text) =
    (
      select id, text
      from json_populate_record(
        null::test_table, (
          select git_resolve(git, git_log(git)->1->>'oid')
          from test_table
          where id = 2
        )
      )
    )
    where id = 2
    returning id, text
  `)

  expect(result).toMatchInlineSnapshot(`
    {
      "id": 2,
      "text": "original value set by alice"
    }
  `)

  // Or a similar technique can restore a deleted item:

  result = await client.one(sql`
    insert into test_table
    select * from json_populate_record(
      null::test_table,
      (
        select git_resolve(git, git_log(git, depth := 1)->0->>'oid')
        from deleted_history
        where tablename = 'test_table' and identifier->>'id' = '1'
      )
    )
    returning id, text
  `)

  expect(result).toMatchInlineSnapshot(`
    {
      "id": 1,
      "text": "updated content"
    }
  `)
})
