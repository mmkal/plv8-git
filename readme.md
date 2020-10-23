# plv8-git

An experimental helper which tracks the modification history of rows in postgres database tables, using git, based on the idea in [this tweet](https://twitter.com/mayfer/status/1308606131426582528).

The implementation uses [plv8](https://github.com/plv8/plv8) to run JavaScript in postgres, with [isomorphic-git](https://npmjs.com/package/isomorphic-git) and [memfs](https://npmjs.com/package) to perform git operations in-memory.

## Usage

The easiest way to get started is to use the pre-baked sql files exported with the package:

```bash
npm install plv8-git
psql -h localhost -U postgres postgres -c "
  create extension if not exists plv8;
  select plv8_version();
  $(cat node_modules/plv8-git/queries/create-git-functions.sql)
"
```

Note: for `create extension plv8` to work the plv8.control file must exist on your database system. You can use [the postgres-plv8 docker image](https://github.com/clkao/docker-postgres-plv8/tree/master/12-2) for development (or production, if you really want to deploy a containerised database to production). Amazon RDS instances [should have the extension available](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html).

This will have created two postgres functions: `git_track` and `git_log`.

<!-- codegen:start {preset: custom, source: scripts/docs.js} -->
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
    "git_log": null
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
    "git": "[git repo]"
  }
]
```

This will return a json-formatted object, with keys corresponding to file system paths, and byte-array values as contents. Write them to disk using the helper function provided:

This will return a json-formatted object, with keys corresponding to file system paths, and byte-array values as contents. Write them to disk using the helper function provided:

```bash
node_modules/.bin/plv8-git \
  --write \
  --input $(psql -h localhost -U postgres postgres -c "select git from test_table where id = 1") \
  --output /path/to/git/dir
```

`/path/to/git/dir` will now be a valid git repository, with one file corresponding to each column in `test_table`.

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

create function v8_test_track_deletion() returns trigger as
$$
  begin
    insert into deleted_history(schemaname, tablename, identifier, deleted_at, git)
    values ('public', 'test_table', jsonb_build_object('id', OLD.id), now(), OLD.git);

    return OLD;
  end
$$
language plpgsql;

create trigger v8_test_track_deletion_trigger
  before delete
  on test_table for each row
  execute procedure v8_test_track_deletion();
```

```sql
delete from test_table
where id = 1
```

The `deleted_history` table can be queried in a similar way:

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
    "git": "[git repo]"
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
    "git_log": null
  }
]
```

In this example, `delete_history` is generic enough that it could be the "history" table for several other relations, since it uses columns `schemaname` and `tablename`, and `identifier` as the flexible `JSONB` data type to allow for different types of primary key. This avoids the overhead of needing a new `_history` table for every relation created - all the data, including history, is captured in the `git` column. The `identifier` column is only used for lookups.
<!-- codegen:end -->