/**
 * an5Orm Migration Tool
 * Compares schema files with database and generates migration SQL.
 *
 * Usage:
 *   npx tsx migrate.ts diff       # Show differences
 *   npx tsx migrate.ts generate   # Generate migration file
 *   npx tsx migrate.ts status     # Show migration status
 */
import 'dotenv/config';
