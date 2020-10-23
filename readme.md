# plv8-git

An experimental helper which tracks the modification history of rows in postgres database tables, using git, based on the idea in [this tweet](https://twitter.com/mayfer/status/1308606131426582528).

The implementation uses [plv8](https://github.com/plv8/plv8) to run JavaScript in postgres, with [isomorphic-git](https://npmjs.com/package/isomorphic-git) and [memfs](https://npmjs.com/package) to perform git operations in-memory.

<!-- codegen:start {preset: markdownTOC, minDepth: 2} -->
- [Motivation](#motivation)
- [Usage](#usage)
   - [Tracking history](#tracking-history)
   - [Deletions](#deletions)
   - [Configuraton](#configuraton)
- [Caveat](#caveat)
- [Implementation](#implementation)
<!-- codegen:end -->

## Motivation

To paraphrase [@mayfer's twitter thread](https://twitter.com/mayfer/status/1308606131426582528):

- never have to worry about building edit/delete/undo/backup/recover type features, one generic git-backed [column] is enough

- removes the need to keep additional SQL tables which keep logs of all edit histories.

- makes event sourcing a lot more modular. instead of tons of tables storing custom events, every SQL update on a column also updates its git bundle, saved into a separate binary column

- with just 1 extra column, you 
can add multiuser versioning to *any* indexed column!

- how cool this will be for large JSON or other text blob columns that get overwritten a lot during the app's lifetime

- since all commits are controlled by the main app, it's trivial to integrate commit authors directly into any regular application's user auth system

- due to the git standard, this repo then can easily be fed into any generic git UI for all sorts of diffing, logging & visualizing

## Usage

The easiest way to get started is to use the pre-baked sql files exported with the package:

```bash
npm install plv8-git

psql -c "
  create extension if not exists plv8;
  select plv8_version();
"

psql -f node_modules/plv8-git/queries/create-git-functions.sql
```

Note: for `create extension plv8` to work the plv8.control file must exist on your database system. You can use [the postgres-plv8 docker image](https://github.com/clkao/docker-postgres-plv8/tree/master/12-2) for development (or production, if you really want to deploy a containerised database to production). Amazon RDS instances [should have the extension available](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html).

This will have created two postgres functions: `git_track` and `git_log`.

<!-- codegen:start {preset: custom, source: scripts/docs.js} -->
### Tracking history

`git_track` is a trigger function that can be added to any table, with a `json` column, default-named `git`:

```sql
create table test_table(
  id int,
  text text,
  git json
);

create trigger test_table_git_track_trigger
  before insert or update
  on test_table for each row
  execute procedure git_track();
```

Now, whenever rows are inserted or updated into the `test_table` table, the `git` column will automatically be managed as a serialisation of the `.git` folder of an ephemeral git repo. All you need to do is `insert`/`update` as normal:

```sql
insert into test_table(id, text)
values(1, 'initial content');

update test_table
set text = 'updated content'
where id = 1;
```

There's still just a single row in the `test_table` table, but the full history of it is tracked in the `git` column. The `git_log` function can be used to access the change history:

```sql
select git_log(git)
from test_table
where id = 1
```

This query will return:

```json
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
```

i.e. you can see the row's full history, in human- and machine-readable form, straight from the table.

To use existing git clients to get rich visual diffs, etc., you can simply pull the `git` field for a given row, and convert it into real files:

```sql
select git from test_table where id = 1
```

```json
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
```

This will return a json-formatted object, with keys corresponding to file system paths, and byte-array values as contents. Write them to disk using the CLI tool provided with this package:

```bash
GIT=$(psql -qAt -c "select git from test_table where id = 1")
node_modules/.bin/plv8-git write --input "$GIT" --output path/to/git/dir
```

`path/to/git/dir` will now be a valid git repository, with one file corresponding to each column in `test_table`. You can `cd` into it, and run commands like `git log`, or use your favourite git UI to inspect the history in as much detail as you'd like.

### Deletions

You can also take advantage of the `git` column to track deletions, by adding a delete hook:

```sql
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
```

You can now perform deletions as normal and they'll be automatically tracked in `deleted_history`:

```sql
delete from test_table
where id = 1
```

The `deleted_history` table can be queried in the same was as the other tables:

```sql
select *
from deleted_history
where identifier->>'id' = '1'
```

This will return something like:

```json
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
```

You can use `git_log` again to get a readable history:

```sql
select git_log(git)
from deleted_history
where identifier->>'id' = '1'
```

```json
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
```

In this example, `deleted_history` is generic enough that it could be the "history" table for several other relations, since it uses columns `schemaname` and `tablename`, and `identifier` as the flexible `JSONB` data type to allow for different types of primary key. This avoids the overhead of needing a new `_history` table for every relation created - all the data, including history, is captured in the `git` column. The `identifier` column is only used for lookups.

### Configuraton

You can pass a custom commit message and author by pre-loading the `git` property with `commit` details, which can include a commit message and user info:

```sql
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
```

```sql
select git_log(git)
from test_table
where id = 2
```

```json
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
```

`git_log` also accepts a `depth` parameter to limit the amount of history that is fetched:

```sql
update test_table
set text = 'a new value',
    git = '{ "commit": { "message": "Changed because the previous value was out-of-date"  } }'
where id = 2
```

```sql
select git_log(git, depth := 1)
from test_table
where id = 2
```

```json
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
```

By setting `depth := 1`, only the most recent change is returned.
<!-- codegen:end -->

## Caveat

- This library is experimental, and hasn't been pressure-tested. There may well be edge-cases where it falls down.
- It hasn't been performance-tested yet. It works well for rows with small, easily-json-stringifiable data. Large, frequently updated rows may hit issues.
- It currently uses the `JSON` data type to store a serialised copy of the `.git` repo folder. This can likely be optimised to use `BYTEA` or another data type.
- It uses several tools that were _not_ built with each other in mind (although each is well-designed and flexible enough for them to play nice without too many problems). See the [implementation section](#implementation)

## Implementation

At its core, this library bundles [isomorphic-git](https://npmjs.com/package/isomorphic-git) and [memfs](https://npmjs.com/package/memfs) to produce an entirely in-memory, synchronous git implementation which can run inside postgres's plv8 engine. A few modifications are applied to each:

Since plv8 triggers need to return values synchronously, but isomorphic-git uses promises extensively, a shim of the global `Promise` object was created called [`SyncPromise`](./src/sync-promise.ts). This has the same API as `Promise`, but its callbacks are executed immediately.

To avoid the event-loop, all async-await code in isomorphic-git is transformed to `.then`, `.catch` etc. by [babel-plugin-transform-async-to-promises](https://npmjs.com/package/babel-plugin-transform-async-to-promises). `async-lock`, which is a dependency of isomorphic-git, is also [shimmed](./scripts/async-lock-shim.js) to bypass its locking mechanism which relies on timers - it's not necessary anyway, since all git operations take place on an ephemeral, in-memory, synchronous filesystem.

`memfs` is also shimmed before being passed to isomorphic-git to [replace its promise-based operations with sync ones](./src/fs.ts).

These libraries are bundled using webpack into a standalone module with no dependencies. The source code for this bundle is copied into a sql file by [generate-queries](./scripts/generate-queries.ts), so that it can be used to define a postgres function with plv8.
