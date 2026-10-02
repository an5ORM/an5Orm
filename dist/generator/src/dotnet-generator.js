"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DotnetGenerator = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const types_1 = require("./types");
const type_kinds_1 = require("./type-kinds");
class DotnetGenerator {
    constructor(outputDir) {
        this.outputDir = outputDir;
        if (!fs_1.default.existsSync(this.outputDir)) {
            fs_1.default.mkdirSync(this.outputDir, { recursive: true });
        }
    }
    generate(models) {
        this.provider = models[0]?.provider;
        // 1. Generate individual C# entity class files
        for (const model of models) {
            this.generateEntityClass(model);
        }
        // 2. Generate per-model ORM types (WhereInput, OrderByInput, FindManyArgs, etc.)
        this.generateOrmTypes(models);
        // 3. Generate DbContext / Client metadata file
        this.generateDbContext(models);
        // 4. Generate configuration helper class
        this.generateConfigClass();
    }
    getCsFilterType(field, isOptional) {
        // From the declared type: a DECIMAL column took the integer filter because it
        // arrived as `number`.
        switch ((0, type_kinds_1.fieldKind)(field, this.provider)) {
            case 'date': return 'DateTimeFilter';
            case 'bool': return 'BoolFilter';
            case 'int':
            case 'bigint': return 'IntFilter';
            case 'float': return 'NumberFilter';
            default: return 'StringFilter';
        }
    }
    generateOrmTypes(models) {
        let content = `// This file is auto-generated. Do not edit directly.
using System;
using System.Collections.Generic;

namespace An5Orm
{
    // ── Base Filter Types ──────────────────────────────────────────────────────

    /// <summary>Type-safe filter for string fields.</summary>
    public class StringFilter
    {
        public new string Equals { get; set; }
        public string Not { get; set; }
        public List<string> In { get; set; }
        public List<string> NotIn { get; set; }
        public string Contains { get; set; }
        public string StartsWith { get; set; }
        public string EndsWith { get; set; }
        public string Gt { get; set; }
        public string Gte { get; set; }
        public string Lt { get; set; }
        public string Lte { get; set; }
    }

    /// <summary>Type-safe filter for integer fields.</summary>
    public class IntFilter
    {
        public new int? Equals { get; set; }
        public int? Not { get; set; }
        public List<int> In { get; set; }
        public List<int> NotIn { get; set; }
        public int? Gt { get; set; }
        public int? Gte { get; set; }
        public int? Lt { get; set; }
        public int? Lte { get; set; }
    }

    /// <summary>Type-safe filter for numeric/float fields.</summary>
    public class NumberFilter
    {
        public new double? Equals { get; set; }
        public double? Not { get; set; }
        public List<double> In { get; set; }
        public List<double> NotIn { get; set; }
        public double? Gt { get; set; }
        public double? Gte { get; set; }
        public double? Lt { get; set; }
        public double? Lte { get; set; }
    }

    /// <summary>Type-safe filter for boolean fields.</summary>
    public class BoolFilter
    {
        public new bool? Equals { get; set; }
    }

    /// <summary>Type-safe filter for DateTime fields.</summary>
    public class DateTimeFilter
    {
        public new DateTime? Equals { get; set; }
        public DateTime? Not { get; set; }
        public List<DateTime> In { get; set; }
        public List<DateTime> NotIn { get; set; }
        public DateTime? Gt { get; set; }
        public DateTime? Gte { get; set; }
        public DateTime? Lt { get; set; }
        public DateTime? Lte { get; set; }
    }

`;
        for (const model of models) {
            const name = this.capitalize(model.name);
            const csType = (f) => this.mapType(f, f.isOptional);
            content += `    // ── ${name} ORM Types ──────────────────────────────────────────────────────\n\n`;
            // WhereInput
            content += `    /// <summary>Type-safe WHERE filter for ${name} queries.</summary>\n`;
            content += `    public class ${name}WhereInput\n    {\n`;
            content += `        public List<${name}WhereInput> AND { get; set; }\n`;
            content += `        public List<${name}WhereInput> OR { get; set; }\n`;
            content += `        public ${name}WhereInput NOT { get; set; }\n`;
            for (const f of model.fields) {
                const ft = this.getCsFilterType(f, f.isOptional);
                content += `        public ${ft} ${this.capitalize(f.name)} { get; set; }\n`;
            }
            content += `    }\n\n`;
            // OrderByInput
            content += `    /// <summary>Type-safe ORDER BY for ${name} queries.</summary>\n`;
            content += `    public class ${name}OrderByInput\n    {\n`;
            for (const f of model.fields) {
                content += `        public string ${this.capitalize(f.name)} { get; set; } // "asc" or "desc"\n`;
            }
            content += `    }\n\n`;
            // CreateInput
            content += `    /// <summary>Typed data for creating a new ${name} record.</summary>\n`;
            content += `    public class ${name}CreateInput\n    {\n`;
            for (const f of model.fields) {
                if (!f.isId) {
                    const ct = this.mapType(f, f.isOptional || f.hasDefault);
                    content += `        public ${ct} ${this.capitalize(f.name)} { get; set; }\n`;
                }
            }
            content += `    }\n\n`;
            // UpdateInput
            content += `    /// <summary>Typed data for updating an existing ${name} record.</summary>\n`;
            content += `    public class ${name}UpdateInput\n    {\n`;
            for (const f of model.fields) {
                if (!f.isId) {
                    const ut = this.mapType(f, true); // always nullable for update
                    content += `        public ${ut} ${this.capitalize(f.name)} { get; set; }\n`;
                }
            }
            content += `    }\n\n`;
            // FindManyArgs
            content += `    /// <summary>ORM-style args for ${name}.FindMany().</summary>\n`;
            content += `    public class ${name}FindManyArgs\n    {\n`;
            content += `        public ${name}WhereInput Where { get; set; }\n`;
            content += `        public ${name}OrderByInput OrderBy { get; set; }\n`;
            content += `        public int? Take { get; set; }\n`;
            content += `        public int? Skip { get; set; }\n`;
            content += `        public List<string> Select { get; set; }\n`;
            content += `    }\n\n`;
            // FindFirstArgs
            content += `    /// <summary>ORM-style args for ${name}.FindFirst().</summary>\n`;
            content += `    public class ${name}FindFirstArgs\n    {\n`;
            content += `        public ${name}WhereInput Where { get; set; }\n`;
            content += `        public ${name}OrderByInput OrderBy { get; set; }\n`;
            content += `        public List<string> Select { get; set; }\n`;
            content += `    }\n\n`;
            // FindUniqueArgs
            content += `    /// <summary>ORM-style args for ${name}.FindUnique().</summary>\n`;
            content += `    public class ${name}FindUniqueArgs\n    {\n`;
            content += `        public ${name}WhereInput Where { get; set; }\n`;
            content += `    }\n\n`;
            // DeleteManyArgs
            content += `    /// <summary>ORM-style args for ${name}.DeleteMany().</summary>\n`;
            content += `    public class ${name}DeleteManyArgs\n    {\n`;
            content += `        public ${name}WhereInput Where { get; set; }\n`;
            content += `    }\n\n`;
            // CountArgs
            content += `    /// <summary>ORM-style args for ${name}.Count().</summary>\n`;
            content += `    public class ${name}CountArgs\n    {\n`;
            content += `        public ${name}WhereInput Where { get; set; }\n`;
            content += `    }\n\n`;
        }
        content += `}\n`;
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, 'An5OrmTypes.cs'), content);
    }
    generateConfigClass() {
        const content = `// This file is auto-generated. Do not edit directly.
using System;

namespace An5Orm
{
    public static class An5Config
    {
        public static string ConnectionString { get; set; } = Environment.GetEnvironmentVariable("DATABASE_URL") ?? "Server=localhost;Database=master;Trusted_Connection=True;TrustServerCertificate=True;";
    }
}
`;
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, 'An5Config.cs'), content);
    }
    /**
     * The C# type for a field.
     *
     * Driven by the declared type, so a `DECIMAL` column is a `decimal` and a `FLOAT`
     * one a `double`: both arrived as `number` and took the `int` branch.
     */
    mapType(field, isOptional) {
        let csType;
        switch ((0, type_kinds_1.fieldKind)(field, this.provider)) {
            case 'int':
                csType = 'int';
                break;
            case 'bigint':
                csType = 'long';
                break;
            case 'float': {
                // `DECIMAL`/`NUMERIC`/`MONEY` are exact and stay `decimal`; a floating
                // column is a `double`. Both used to arrive as `number` and became `int`.
                const base = (field.sqlType ?? field.type).replace(/\([^)]*\)/g, '').trim().toUpperCase();
                csType = ['DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY'].includes(base) ? 'decimal' : 'double';
                break;
            }
            case 'bool':
                csType = 'bool';
                break;
            case 'date': {
                const base = (field.sqlType ?? field.type).replace(/\([^)]*\)/g, '').trim().toUpperCase();
                csType = base === 'DATETIMEOFFSET' ? 'DateTimeOffset' : base === 'TIME' ? 'TimeSpan' : 'DateTime';
                break;
            }
            case 'bytes':
                csType = 'byte[]';
                break;
            case 'vector':
                csType = 'float[]';
                break;
            // JSON, XML, geometry and the rest stay strings: they are read as text and a
            // Guid column is covered by the string case below via its declared name.
            default: {
                const base = (field.sqlType ?? field.type).replace(/\([^)]*\)/g, '').trim().toUpperCase();
                csType = ['GUID', 'UUID', 'UNIQUEIDENTIFIER'].includes(base) ? 'Guid' : 'string';
                break;
            }
        }
        if (isOptional && csType !== 'string' && !csType.endsWith('[]')) {
            csType += '?';
        }
        return csType;
    }
    generateEntityClass(model) {
        let content = `// This file is auto-generated. Do not edit directly.
using System;
using System.Collections.Generic;

namespace An5Orm.Entities
{
    public class ${model.name}
    {
`;
        // Generate fields
        for (const field of model.fields) {
            const csType = this.mapType(field, field.isOptional);
            content += `        public ${csType} ${this.capitalize(field.name)} { get; set; }\n`;
        }
        // Generate relations
        if (model.relations.length > 0) {
            content += '\n        // ── Relations ────────────────────────────────────────────────────────\n';
            for (const rel of model.relations) {
                if (rel.isArray) {
                    content += `        public List<${rel.type}> ${this.capitalize(rel.name)} { get; set; } = new List<${rel.type}>();\n`;
                }
                else {
                    content += `        public ${rel.type} ${this.capitalize(rel.name)} { get; set; }\n`;
                }
            }
        }
        content += `    }
}
`;
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, `${model.name}.cs`), content);
    }
    generateDbContext(models) {
        let content = `// This file is auto-generated. Do not edit directly.
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.Reflection;
using System.Text.Json;
using An5Orm.Entities;

namespace An5Orm
{
    /// <summary>SQL dialects this client can talk to.</summary>
    public enum An5Dialect
    {
        Mssql,
        Postgres,
        Sqlite
    }

    /// <summary>
    /// Picks the ADO.NET provider and rewrites the connection string.
    ///
    /// Everything below works against DbConnection/DbCommand rather than the
    /// SQL Server types, because SqlClient, Npgsql and Sqlite each derive from
    /// those but share no other members. Only the SQL that differs per dialect
    /// is branched on.
    /// </summary>
    internal static class An5Provider
    {
        public static An5Dialect Detect(string connectionString)
        {
            var cs = (connectionString ?? "").Trim().ToLowerInvariant();
            // SQLite first: a bare path or Data Source= would otherwise fall
            // through to SQL Server.
            if (cs.StartsWith("sqlite:") || cs.StartsWith("file:") || cs == ":memory:"
                || cs.Contains("data source=") || cs.Contains("datasource=")
                || cs.EndsWith(".db") || cs.EndsWith(".sqlite") || cs.EndsWith(".sqlite3"))
                return An5Dialect.Sqlite;
            if (cs.StartsWith("postgres://") || cs.StartsWith("postgresql://") || cs.Contains("host="))
                return An5Dialect.Postgres;
            return An5Dialect.Mssql;
        }

        /// <summary>
        /// Rewrites the accepted SQLite spellings into the one
        /// Microsoft.Data.Sqlite reads, which is Data Source=.
        /// </summary>
        public static string NormalizeSqlite(string connectionString)
        {
            var cs = (connectionString ?? "").Trim();
            if (cs.Length == 0) return "Data Source=:memory:";
            if (cs.IndexOf("Data Source", StringComparison.OrdinalIgnoreCase) >= 0
                || cs.IndexOf("DataSource", StringComparison.OrdinalIgnoreCase) >= 0
                || cs.IndexOf("Mode", StringComparison.OrdinalIgnoreCase) >= 0)
                return cs;
            if (cs == ":memory:") return "Data Source=:memory:";
            if (cs.StartsWith("sqlite://", StringComparison.OrdinalIgnoreCase))
                return "Data Source=" + cs.Substring("sqlite://".Length);
            if (cs.StartsWith("sqlite:", StringComparison.OrdinalIgnoreCase))
                return "Data Source=" + cs.Substring("sqlite:".Length);
            if (cs.StartsWith("file:", StringComparison.OrdinalIgnoreCase)) return cs;
            return "Data Source=" + cs;
        }

        public static DbConnection Open(string connectionString, An5Dialect dialect)
        {
            DbConnection conn = dialect switch
            {
                An5Dialect.Postgres => new Npgsql.NpgsqlConnection(connectionString),
                An5Dialect.Sqlite => new Microsoft.Data.Sqlite.SqliteConnection(NormalizeSqlite(connectionString)),
                _ => new Microsoft.Data.SqlClient.SqlConnection(connectionString)
            };
            conn.Open();
            if (dialect == An5Dialect.Sqlite)
            {
                // WAL keeps readers off the writer's back, and SQLite leaves
                // foreign keys off even when the schema declares them.
                using var pragma = conn.CreateCommand();
                pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;";
                pragma.ExecuteNonQuery();
            }
            return conn;
        }

        /// <summary>
        /// Adds a parameter. The name is stored without the @ prefix: Npgsql and
        /// Sqlite treat a leading @ as part of the name, while SqlClient adds it
        /// back, so stripping it is the only spelling all three agree on.
        /// </summary>
        public static DbParameter Bind(DbCommand cmd, string name, object value)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = (name ?? "").TrimStart('@');
            p.Value = value ?? DBNull.Value;
            cmd.Parameters.Add(p);
            return p;
        }

        /// <summary>Quotes an identifier for the dialect.</summary>
        public static string Quote(string name, An5Dialect dialect)
        {
            if (name.StartsWith("[") || name.StartsWith("\\"")) return name;
            if (dialect == An5Dialect.Mssql)
                return "[" + name.Replace("]", "]]") + "]";
            return "\\"" + name.Replace("\\"", "\\"\\"") + "\\"";
        }

        /// <summary>Schema-less engines have no dbo prefix on the generated table names.</summary>
        public static string TableName(string tableName, An5Dialect dialect)
        {
            if (dialect != An5Dialect.Sqlite) return tableName;
            if (tableName.StartsWith("dbo.", StringComparison.OrdinalIgnoreCase))
                return tableName.Substring(4);
            return tableName;
        }
    }

    public class An5DbContext
    {
        public string ConnectionString { get; }
        public An5Dialect Dialect { get; }

        [ThreadStatic]
        private static DbConnection _txConn;
        [ThreadStatic]
        private static DbTransaction _tx;

        public An5DbContext(string connectionString = null)
        {
            ConnectionString = connectionString ?? An5Config.ConnectionString;
            Dialect = An5Provider.Detect(ConnectionString);
        }

        public An5Transaction BeginTransaction()
        {
            var conn = An5Provider.Open(ConnectionString, Dialect);
            var tx = conn.BeginTransaction();
            _txConn = conn;
            _tx = tx;
            return new An5Transaction(conn, tx, () => {
                _txConn = null;
                _tx = null;
            });
        }

        public static DbConnection GetActiveConnection(string connectionString, out bool isTx)
        {
            if (_txConn != null)
            {
                isTx = true;
                return _txConn;
            }
            isTx = false;
            return An5Provider.Open(connectionString, An5Provider.Detect(connectionString));
        }

        public static DbTransaction GetActiveTransaction() => _tx;

        // ── Tables / Repositories ──────────────────────────────────────────────
`;
        for (const model of models) {
            const name = this.capitalize(model.name);
            content += `        public TableClient<${model.name}> ${name}s => new TableClient<${model.name}>(ConnectionString, "${(0, types_1.dottedTableName)(model)}");\n`;
            content += `        public TableClient<${model.name}> ${name} => ${name}s;\n`;
        }
        content += `    }

    public class An5Transaction : IDisposable
    {
        private readonly DbConnection _conn;
        private readonly DbTransaction _tx;
        private readonly Action _cleanup;
        private bool _completed;

        public An5Transaction(DbConnection conn, DbTransaction tx, Action cleanup)
        {
            _conn = conn;
            _tx = tx;
            _cleanup = cleanup;
        }

        public void Commit()
        {
            _tx.Commit();
            _completed = true;
        }

        public void Rollback()
        {
            _tx.Rollback();
            _completed = true;
        }

        public void Dispose()
        {
            if (!_completed)
            {
                try { _tx.Rollback(); } catch { }
            }
            _tx.Dispose();
            _conn.Dispose();
            _cleanup();
        }
    }

    public class TableClient<T> where T : new()
    {
        public string ConnectionString { get; }
        public string TableName { get; }
        public An5Dialect Dialect { get; }

        public TableClient(string connectionString, string tableName)
        {
            ConnectionString = connectionString;
            Dialect = An5Provider.Detect(connectionString);
            // SQLite has no schemas, so the generated dbo. prefix would be part
            // of the table name and match nothing.
            TableName = An5Provider.TableName(tableName, Dialect);
        }

        private DbCommand CreateCommand(DbConnection conn, string query)
        {
            var cmd = conn.CreateCommand();
            cmd.CommandText = query;
            var activeTx = An5DbContext.GetActiveTransaction();
            if (activeTx != null)
            {
                cmd.Transaction = activeTx;
            }
            return cmd;
        }

        public List<T> QueryRaw(string query, Dictionary<string, object> parameters = null)
        {
            var list = new List<T>();
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    if (parameters != null)
                    {
                        foreach (var kvp in parameters)
                        {
                            An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                        }
                    }

                    using (var reader = cmd.ExecuteReader())
                    {
                        var properties = typeof(T).GetProperties(BindingFlags.Public | BindingFlags.Instance);
                        while (reader.Read())
                        {
                            var item = new T();
                            foreach (var prop in properties)
                            {
                                if (HasColumn(reader, prop.Name))
                                {
                                    var val = reader[prop.Name];
                                    if (val != DBNull.Value)
                                    {
                                        SetValue(prop, item, val);
                                    }
                                }
                            }
                            list.Add(item);
                        }
                    }
                }
            }
            finally
            {
                if (!isTx) conn.Dispose();
            }
            return list;
        }

        public List<T> FindMany(string whereClause = null, Dictionary<string, object> parameters = null)
        {
            var list = new List<T>();
            string query = $"SELECT * FROM {TableName}";
            if (!string.IsNullOrEmpty(whereClause))
            {
                query += $" WHERE {whereClause}";
            }

            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    if (parameters != null)
                    {
                        foreach (var kvp in parameters)
                        {
                            An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                        }
                    }

                    using (var reader = cmd.ExecuteReader())
                    {
                        var properties = typeof(T).GetProperties(BindingFlags.Public | BindingFlags.Instance);
                        while (reader.Read())
                        {
                            var item = new T();
                            foreach (var prop in properties)
                            {
                                if (HasColumn(reader, prop.Name))
                                {
                                    var val = reader[prop.Name];
                                    if (val != DBNull.Value)
                                    {
                                        SetValue(prop, item, val);
                                    }
                                }
                            }
                            list.Add(item);
                        }
                    }
                }
            }
            finally
            {
                if (!isTx) conn.Dispose();
            }
            return list;
        }

        public T FindFirst(string whereClause = null, Dictionary<string, object> parameters = null)
        {
            // TOP goes before the table, LIMIT after the WHERE — appending LIMIT
            // to the SELECT would put it ahead of the predicate.
            string query = Dialect == An5Dialect.Mssql
                ? $"SELECT TOP 1 * FROM {TableName}"
                : $"SELECT * FROM {TableName}";
            if (!string.IsNullOrEmpty(whereClause))
            {
                query += $" WHERE {whereClause}";
            }
            if (Dialect != An5Dialect.Mssql)
            {
                query += " LIMIT 1";
            }

            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    if (parameters != null)
                    {
                        foreach (var kvp in parameters)
                        {
                            An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                        }
                    }

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (reader.Read())
                        {
                            var item = new T();
                            var properties = typeof(T).GetProperties(BindingFlags.Public | BindingFlags.Instance);
                            foreach (var prop in properties)
                            {
                                if (HasColumn(reader, prop.Name))
                                {
                                    var val = reader[prop.Name];
                                    if (val != DBNull.Value)
                                    {
                                        SetValue(prop, item, val);
                                    }
                                }
                            }
                            return item;
                        }
                    }
                }
            }
            finally
            {
                if (!isTx) conn.Dispose();
            }
            return default;
        }

        public T FindUnique(object id)
        {
            return FindFirst("Id = @id", new Dictionary<string, object> { { "id", id } });
        }

        public T Create(T entity)
        {
            var properties = typeof(T).GetProperties(BindingFlags.Public | BindingFlags.Instance);
            var columns = new List<string>();
            var values = new List<string>();
            // Collected before the command exists; the provider creates the
            // concrete parameter type, so binding has to wait for the command.
            var sqlParams = new List<(string Name, object Value)>();

            foreach (var prop in properties)
            {
                var val = prop.GetValue(entity);
                if (val != null)
                {
                    columns.Add(prop.Name);
                    values.Add("@" + prop.Name);
                    sqlParams.Add((prop.Name, val));
                }
            }

            string query = $"INSERT INTO {TableName} ({string.Join(", ", columns)}) VALUES ({string.Join(", ", values)})";
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    foreach (var (name, value) in sqlParams) An5Provider.Bind(cmd, name, value);
                    cmd.ExecuteNonQuery();
                    if (!isTx)
                    {
                        // Commit standard queries if not in transaction
                    }
                }
            }
            finally
            {
                if (!isTx) conn.Dispose();
            }
            return entity;
        }

        public T Update(T entity)
        {
            var properties = typeof(T).GetProperties(BindingFlags.Public | BindingFlags.Instance);
            var sets = new List<string>();
            // Collected before the command exists; the provider creates the
            // concrete parameter type, so binding has to wait for the command.
            var sqlParams = new List<(string Name, object Value)>();
            object idVal = null;

            foreach (var prop in properties)
            {
                var val = prop.GetValue(entity);
                if (prop.Name.Equals("Id", StringComparison.OrdinalIgnoreCase))
                {
                    idVal = val;
                }
                else if (val != null)
                {
                    sets.Add($"{prop.Name} = @{prop.Name}");
                    sqlParams.Add((prop.Name, val));
                }
            }

            if (idVal == null)
            {
                throw new InvalidOperationException("Cannot update entity without Id");
            }

            sqlParams.Add(("id", idVal));
            string query = $"UPDATE {TableName} SET {string.Join(", ", sets)} WHERE Id = @id";
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    foreach (var (name, value) in sqlParams) An5Provider.Bind(cmd, name, value);
                    cmd.ExecuteNonQuery();
                }
            }
            finally
            {
                if (!isTx) conn.Dispose();
            }
            return entity;
        }

        public bool Delete(object id)
        {
            string query = $"DELETE FROM {TableName} WHERE Id = @id";
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    An5Provider.Bind(cmd, "id", id);
                    int affected = cmd.ExecuteNonQuery();
                    return affected > 0;
                }
            }
            finally
            {
                if (!isTx) conn.Dispose();
            }
        }

        public int Count(string whereClause = null, Dictionary<string, object> parameters = null)
        {
            string query = $"SELECT COUNT(*) FROM {TableName}";
            if (!string.IsNullOrEmpty(whereClause)) query += $" WHERE {whereClause}";
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    if (parameters != null)
                    {
                        foreach (var kvp in parameters)
                            An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                    }
                    var res = cmd.ExecuteScalar();
                    return res != null && res != DBNull.Value ? Convert.ToInt32(res) : 0;
                }
            }
            finally { if (!isTx) conn.Dispose(); }
        }

        public int CreateMany(IEnumerable<T> entities)
        {
            int count = 0;
            foreach (var entity in entities)
            {
                Create(entity);
                count++;
            }
            return count;
        }

        public int UpdateMany(string whereClause, Dictionary<string, object> updateData, Dictionary<string, object> parameters = null)
        {
            if (updateData == null || updateData.Count == 0) return 0;
            var sets = new List<string>();
            // Bound after the command exists, so the provider can create the
            // right parameter type; a value tuple carries (name, value) until then.
            var sqlParams = new List<(string Name, object Value)>();
            int pIndex = 0;
            foreach (var kvp in updateData)
            {
                string paramName = "@u_" + pIndex++;
                sets.Add($"{kvp.Key} = {paramName}");
                sqlParams.Add((paramName, kvp.Value));
            }
            string query = $"UPDATE {TableName} SET {string.Join(", ", sets)}";
            if (!string.IsNullOrEmpty(whereClause)) query += $" WHERE {whereClause}";
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    foreach (var (name, value) in sqlParams) An5Provider.Bind(cmd, name, value);
                    if (parameters != null)
                    {
                        foreach (var kvp in parameters)
                            An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                    }
                    return cmd.ExecuteNonQuery();
                }
            }
            finally { if (!isTx) conn.Dispose(); }
        }

        public int DeleteMany(string whereClause = null, Dictionary<string, object> parameters = null)
        {
            string query = $"DELETE FROM {TableName}";
            if (!string.IsNullOrEmpty(whereClause)) query += $" WHERE {whereClause}";
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    if (parameters != null)
                    {
                        foreach (var kvp in parameters)
                            An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                    }
                    return cmd.ExecuteNonQuery();
                }
            }
            finally { if (!isTx) conn.Dispose(); }
        }

        public T Upsert(T entity, string idColumnName = "Id")
        {
            var prop = typeof(T).GetProperty(idColumnName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (prop == null) throw new InvalidOperationException($"Property '{idColumnName}' not found on entity.");
            var idVal = prop.GetValue(entity);
            var existing = idVal != null ? FindUnique(idVal) : default;
            if (existing != null) return Update(entity);
            return Create(entity);
        }

        public List<T> VectorSearch(List<double> vector, int take = 10, string whereClause = null, Dictionary<string, object> parameters = null, string vectorField = "Embedding", string distanceMetric = "cosine")
        {
            // 1. Primary path: native vector query. SQL Server has VECTOR_DISTANCE
            //    and Postgres has pgvector; SQLite has no vector operator, so it is
            //    skipped outright rather than issuing SQL that can only fail and
            //    cost a round trip before falling through.
            if (Dialect != An5Dialect.Sqlite)
            try
            {
                var dim = vector.Count;
                var vecJson = JsonSerializer.Serialize(vector);
                var field = An5Provider.Quote(vectorField, Dialect);
                string sql;
                if (Dialect == An5Dialect.Postgres)
                {
                    var op = distanceMetric.Equals("cosine", StringComparison.OrdinalIgnoreCase) ? "<=>"
                           : (distanceMetric.Equals("euclidean", StringComparison.OrdinalIgnoreCase) ? "<->" : "<#>");
                    sql = $"SELECT *, ({field} {op} @query_vector::vector) AS distance FROM {TableName}";
                }
                else
                {
                    sql = $"SELECT TOP ({take}) *, VECTOR_DISTANCE('{distanceMetric}', CAST({field} AS VECTOR({dim}, float32)), CAST(@query_vector AS VECTOR({dim}, float32))) AS distance FROM {TableName} WITH (NOLOCK)";
                }

                var p = parameters != null ? new Dictionary<string, object>(parameters) : new Dictionary<string, object>();
                p["query_vector"] = vecJson;

                if (!string.IsNullOrWhiteSpace(whereClause))
                    sql += $" WHERE {field} IS NOT NULL AND ({whereClause})";
                else
                    sql += $" WHERE {field} IS NOT NULL";
                sql += " ORDER BY distance ASC";
                if (Dialect == An5Dialect.Postgres) sql += $" LIMIT {take}";

                var nativeRows = QueryRaw(sql, p);
                if (nativeRows != null) return nativeRows;
            }
            catch
            {
                // Fallback to in-memory similarity computation if the database has no native vector support
            }

            // 2. Secondary fallback: In-memory similarity computation
            var rows = FindMany(whereClause, parameters);
            var results = new List<Tuple<T, double>>();

            var propInfo = typeof(T).GetProperty(vectorField, BindingFlags.Public | BindingFlags.Instance);
            if (propInfo == null)
            {
                propInfo = typeof(T).GetProperty(vectorField, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            }
            if (propInfo == null) return rows;

            foreach (var row in rows)
            {
                List<double> rowVector = null;
                var rawVal = propInfo.GetValue(row);
                if (rawVal != null)
                {
                    try
                    {
                        if (rawVal is string jsonStr)
                        {
                            rowVector = ParseDoubleArray(jsonStr);
                        }
                    }
                    catch { }
                }

                if (rowVector != null && rowVector.Count == vector.Count)
                {
                    double sim = CosineSimilarity(vector, rowVector);
                    double distance = distanceMetric.Equals("cosine", StringComparison.OrdinalIgnoreCase) ? (1.0 - sim) : sim;
                    results.Add(Tuple.Create(row, distance));
                }
            }

            results.Sort((a, b) => a.Item2.CompareTo(b.Item2));

            var output = new List<T>();
            int limit = Math.Min(take, results.Count);
            for (int i = 0; i < limit; i++)
            {
                var distanceProp = typeof(T).GetProperty("Distance", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (distanceProp != null && distanceProp.PropertyType == typeof(double))
                {
                    distanceProp.SetValue(results[i].Item1, results[i].Item2);
                }
                output.Add(results[i].Item1);
            }
            return output;
        }

        private static List<double> ParseDoubleArray(string json)
        {
            var clean = json.Trim('[', ']');
            if (string.IsNullOrWhiteSpace(clean)) return new List<double>();
            
            var parts = clean.Split(',');
            var list = new List<double>();
            foreach (var p in parts)
            {
                if (double.TryParse(p.Trim(), out double d))
                    list.Add(d);
            }
            return list;
        }

        private static double CosineSimilarity(List<double> v1, List<double> v2)
        {
            double dot = 0.0, m1 = 0.0, m2 = 0.0;
            for (int i = 0; i < v1.Count; i++)
            {
                dot += v1[i] * v2[i];
                m1 += v1[i] * v1[i];
                m2 += v2[i] * v2[i];
            }
            if (m1 == 0 || m2 == 0) return 0.0;
            return dot / (Math.Sqrt(m1) * Math.Sqrt(m2));
        }

        /// <summary>
        /// Assigns a column to a property, converting when the provider's CLR
        /// type does not match the property.
        ///
        /// Required across dialects, not just for SQLite: SQLite hands back
        /// dates as TEXT and every integer as Int64, so a DateTime or int
        /// property would otherwise fail to set. A value that cannot be
        /// converted is skipped rather than aborting the whole read.
        /// </summary>
        private static void SetValue(System.Reflection.PropertyInfo prop, object target, object value)
        {
            var wanted = prop.PropertyType;
            if (wanted.IsInstanceOfType(value))
            {
                prop.SetValue(target, value);
                return;
            }
            try
            {
                var underlying = Nullable.GetUnderlyingType(wanted);
                if (underlying != null && value == null) { prop.SetValue(target, null); return; }
                if (underlying != null)
                {
                    prop.SetValue(target, Convert.ChangeType(value, underlying));
                    return;
                }
                if (value is string text && wanted == typeof(Guid)) { prop.SetValue(target, Guid.Parse(text)); return; }
                if (value is string when && wanted == typeof(DateTime)) { prop.SetValue(target, DateTime.Parse(when, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind)); return; }
                prop.SetValue(target, Convert.ChangeType(value, wanted));
            }
            catch { }
        }

        private bool HasColumn(DbDataReader reader, string columnName)
        {
            for (int i = 0; i < reader.FieldCount; i++)
            {
                if (reader.GetName(i).Equals(columnName, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }
    }
}
`;
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, 'An5DbContext.cs'), content);
    }
    capitalize(str) {
        if (!str)
            return '';
        return str[0].toUpperCase() + str.slice(1);
    }
}
exports.DotnetGenerator = DotnetGenerator;
