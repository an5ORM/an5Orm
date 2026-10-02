/**
 * Applying a schema to a database: what `db:push` does once the schema is read.
 *
 * Kept out of `push.ts` so the sequence can be run against a real database in a
 * test — the CLI needs a live server, and a test that re-implements the sequence
 * instead of calling it proves only that the copy works.
 *
 * The database is two functions rather than the adapter, which keeps this testable
 * and keeps the driver out of the decision making.
 */
import { PushDialect } from './dialect';
import { PushModel } from './push-schema';
/** The two things this needs from a database connection. */
export interface PushDatabase {
    /** Runs a query and returns its rows; existence checks are `length > 0`. */
    query(sql: string): Promise<readonly unknown[]>;
    /** Runs one statement. */
    execute(sql: string): Promise<void>;
    /** Progress, so the CLI prints what it is doing. */
    log(message: string): void;
}
export interface ApplyResult {
    /** How many tables were created, and how many altered. */
    tablesCreated: number;
    tablesAltered: number;
    columnsAdded: number;
    indexesCreated: number;
    uniqueConstraintsAdded: number;
}
/**
 * Creates whatever the schema has and the database does not.
 *
 * The order is deliberate: a table first, then missing columns, then unique
 * constraints and indexes — a unique over a column that does not exist yet fails.
 * Everything is checked before it is created, so running it twice changes nothing.
 */
export declare function applySchema(models: readonly PushModel[], dialect: PushDialect, db: PushDatabase): Promise<ApplyResult>;
