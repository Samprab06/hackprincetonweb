# Local Postgres/PostGIS for development

The existing Drizzle schema and `postgres` client work with local PostgreSQL.
Use PostGIS too: catchment queries need spatial types and functions. Neon remains
the hosted choice for Vercel; local development does not require a Neon account.

## Native macOS (Homebrew)

These steps use a native PostgreSQL 17 service. Before installing or starting
anything, inspect existing services and port 5432 (`brew services list` and
`lsof -nP -iTCP:5432 -sTCP:LISTEN`). Reuse an authorized development instance
or choose a separate port; never overwrite another database or its configuration.
Homebrew must already be installed and package downloads must be available.

```sh
brew install postgresql@17 postgis
brew services start postgresql@17
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
pg_isready -h 127.0.0.1 -p 5432
```

Confirm that PostgreSQL 17 finds the installed PostGIS control file before
proceeding (`ls "$(pg_config --sharedir)/extension/postgis.control"`). If it is
missing, use a matching PostGIS build for this PostgreSQL installation; do not
copy extension binaries between versions. Create a dedicated database only if it
does not already exist, using the local PostgreSQL role created for your macOS
account. Connect to that exact database and enable and verify the extension:

```sh
createdb -h 127.0.0.1 -p 5432 hackprinceton_dev
psql -h 127.0.0.1 -p 5432 -d hackprinceton_dev -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS postgis; SELECT PostGIS_Full_Version();'
```

If TCP authentication requires a password, use PostgreSQL's password prompt or
a protected password file. Set `DATABASE_URL` in the existing ignored `.env.local`
without overwriting other variables. For a local role whose connection works
without a password, its format is:

```dotenv
DATABASE_URL=postgresql://YOUR_POSTGRES_ROLE@127.0.0.1:5432/hackprinceton_dev
```

Replace the role with the actual PostgreSQL role, and include a password if your
server requires it. Percent-encode reserved characters in URL credentials. Do
not put real credentials in Git or shell output. Homebrew services may be stopped
and restarted with `brew services stop postgresql@17` and `brew services start
postgresql@17`; don't stop a shared service without checking who uses it.

## Native Windows (EDB PostgreSQL + Stack Builder)

1. Check for an existing PostgreSQL installation and port 5432 before making
   changes. Preserve existing databases and use an authorized development server.
2. Download the [Windows PostgreSQL installer](https://www.postgresql.org/download/windows/).
   Install a supported PostgreSQL release, noting its port and the `postgres`
   administrator password. The installer includes pgAdmin and Stack Builder.
3. Open Stack Builder, select the installed server, then select **Spatial
   Extensions → PostGIS bundle** compatible with that PostgreSQL major version.
   See [PostGIS Windows instructions](https://postgis.net/documentation/getting_started/install_windows/released_versions/).
   Windows administrator/UAC prompts or installer dialogs can require user input;
   agents must not bypass them.
4. In pgAdmin, connect to that server and create `hackprinceton_dev` only if it
   does not already exist. Open its Query Tool and execute:

   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   SELECT PostGIS_Full_Version();
   ```

   The role executing `CREATE EXTENSION` needs the required database privileges.
   Confirm the query returns a PostGIS version. A missing extension control file
   indicates a missing or mismatched PostGIS installation.

5. Preserve the existing project `.env.local` and set `DATABASE_URL` to the
   local development database, using the actual PostgreSQL role, port and
   password. Example format: `postgresql://ROLE:PASSWORD@127.0.0.1:5432/hackprinceton_dev`.
   Percent-encode reserved URL characters in the credentials; do not commit the
   file or paste real credentials into logs. Ensure the PostgreSQL Windows
   service is running before connecting.

## Initialize and verify the app

For either native setup, from the project directory run `pnpm install`,
`pnpm db:migrate`, then `pnpm dev`. Check `GET /api/health` for the database and
PostGIS status. Source tables use separate importer DDL; follow
[public-data-import.md](public-data-import.md) for the Census and full-source
commands. The full import needs DuckDB for Overture. These native instructions
have not been executed on either platform in this PR. Vercel deployments need a
reachable hosted PostgreSQL/PostGIS database; localhost is development-only.

## Docker alternative

Install and start a Docker-compatible engine first (the Docker CLI alone is not
enough). The [PostGIS community image](https://github.com/postgis/docker-postgis)
initializes PostGIS in the configured database. This example uses PostgreSQL 17,
a dedicated persistent volume and localhost port 5433 to avoid the usual 5432.
The image supports amd64; Apple Silicon needs Docker's amd64 emulation.

```sh
docker run --name hackprinceton-dev-db --platform linux/amd64 \
  -e POSTGRES_USER=hackprinceton \
  -e POSTGRES_PASSWORD=local-development-only \
  -e POSTGRES_DB=hackprinceton \
  -p 127.0.0.1:5433:5432 \
  -v hackprinceton-dev-db:/var/lib/postgresql/data \
  -d postgis/postgis:17-3.7

docker exec hackprinceton-dev-db pg_isready -U hackprinceton -d hackprinceton
docker exec hackprinceton-dev-db psql -U hackprinceton -d hackprinceton \
  -c 'SELECT PostGIS_Full_Version();'
```

Set this development-only connection in ignored `.env.local`, preserving other
settings already in that file:

```dotenv
DATABASE_URL=postgresql://hackprinceton:local-development-only@127.0.0.1:5433/hackprinceton
```

Then initialize application tables and start the app:

```sh
pnpm db:migrate
pnpm dev
```

`GET /api/health` should report database/PostGIS availability. Application
migrations and the source import DDL are separate: the source importer creates
its own tables. [Census preparation](public-data-import.md#keyless-census-download-hac-46)
works before the database starts. The full public-data import also needs DuckDB
for Overture, and replaces all three public source tables transactionally:

```sh
pnpm exec tsx scripts/fetch-public-data.ts --acs-summary
```

Stop/resume the same database with `docker stop hackprinceton-dev-db` and
`docker start hackprinceton-dev-db`. Data remains in the named volume. Keep this
localhost connection out of Vercel: deployed functions need a reachable hosted
Postgres connection, such as Neon with PostGIS enabled.

These setup instructions were checked against the image documentation. Local
database startup/import was not executed for HAC-46 because this machine has a
Docker CLI but no running daemon. Hosted verification remains HAC-44.
