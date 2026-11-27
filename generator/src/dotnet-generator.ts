import fs from 'fs';
import path from 'path';
import { Model, Field, Relation, dottedTableName } from './types';
import { fieldKind } from './type-kinds';
import { Provider } from './field-types';

export class DotnetGenerator {
  /** The database being generated for; decides types like `TIMESTAMP`. */
  private provider: Provider | undefined;

  constructor(private outputDir: string) {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  public generate(models: Model[]) {
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

  private getCsFilterType(field: Field, isOptional: boolean): string {
    // From the declared type: a DECIMAL column took the integer filter because it
    // arrived as `number`.
    switch (fieldKind(field, this.provider)) {
      case 'date': return 'DateTimeFilter';
      case 'bool': return 'BoolFilter';
      case 'int':
      case 'bigint': return 'IntFilter';
      case 'float': return 'NumberFilter';
      default: return 'StringFilter';
    }
  }

  private generateOrmTypes(models: Model[]) {
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
        public string Mode { get; set; } // "default" | "insensitive"
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
        public bool? Not { get; set; }
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

    internal interface IAn5WhereInput { }

    internal interface IAn5HavingInput { }

    internal interface IAn5QueryArgs { }

    internal interface IAn5Include { }

    internal interface IAn5GroupByArgs { }

    internal interface IListRelationFilter
    {
        object SomeTarget { get; }
        object NoneTarget { get; }
        object EveryTarget { get; }
    }

    internal interface IRelationFilter
    {
        object IsTarget { get; }
        bool IsNull { get; }
        object IsNotTarget { get; }
        bool IsNotNull { get; }
    }

    /// <summary>Type-safe correlated filter for to-many relations.</summary>
    public class ListRelationFilter<T> : IListRelationFilter
    {
        public T Some { get; set; }
        public T None { get; set; }
        public T Every { get; set; }

        object IListRelationFilter.SomeTarget => Some;
        object IListRelationFilter.NoneTarget => None;
        object IListRelationFilter.EveryTarget => Every;
    }

    /// <summary>Type-safe correlated filter for to-one relations.</summary>
    public class RelationFilter<T> : IRelationFilter
    {
        public T Is { get; set; }
        public bool IsNull { get; set; }
        public T IsNot { get; set; }
        public bool IsNotNull { get; set; }

        object IRelationFilter.IsTarget => Is;
        bool IRelationFilter.IsNull => IsNull;
        object IRelationFilter.IsNotTarget => IsNot;
        bool IRelationFilter.IsNotNull => IsNotNull;
    }

`;

    for (const model of models) {
      const name = this.capitalize(model.name);
      const csType = (f: Field) => this.mapType(f, f.isOptional);

      content += `    // ── ${name} ORM Types ──────────────────────────────────────────────────────\n\n`;

      // WhereInput
      content += `    /// <summary>Type-safe WHERE filter for ${name} queries.</summary>\n`;
      content += `    public class ${name}WhereInput : IAn5WhereInput\n    {\n`;
      content += `        public List<${name}WhereInput> AND { get; set; }\n`;
      content += `        public List<${name}WhereInput> OR { get; set; }\n`;
      content += `        public ${name}WhereInput NOT { get; set; }\n`;
      for (const f of model.fields) {
        const ft = this.getCsFilterType(f, f.isOptional);
        content += `        public ${ft} ${this.capitalize(f.name)} { get; set; }\n`;
      }
      for (const rel of model.relations) {
        const targetWhere = `${this.capitalize(rel.type)}WhereInput`;
        const relFilterType = rel.isArray
          ? `ListRelationFilter<${targetWhere}>`
          : `RelationFilter<${targetWhere}>`;
        content += `        public ${relFilterType} ${this.capitalize(rel.name)} { get; set; }\n`;
      }
      content += `    }\n\n`;

      // OrderByInput
      content += `    /// <summary>Type-safe ORDER BY for ${name} queries.</summary>\n`;
      content += `    public class ${name}OrderByInput\n    {\n`;
      for (const f of model.fields) {
        content += `        public string ${this.capitalize(f.name)} { get; set; } // "asc" or "desc"\n`;
      }
      content += `    }\n\n`;

      // Create / update / delete inputs describe writes; a view has none.
      if (!model.isView) {
        content += `    /// <summary>Typed data for creating a new ${name} record.</summary>\n`;
        content += `    public class ${name}CreateInput\n    {\n`;
        for (const f of model.fields) {
          if (!f.isId) {
            const ct = this.mapType(f, f.isOptional || f.hasDefault);
            content += `        public ${ct} ${this.capitalize(f.name)} { get; set; }\n`;
          }
        }
        content += `    }\n\n`;

        content += `    /// <summary>Typed data for updating an existing ${name} record.</summary>\n`;
        content += `    public class ${name}UpdateInput\n    {\n`;
        for (const f of model.fields) {
          if (!f.isId) {
            const ut = this.mapType(f, true); // always nullable for update
            content += `        public ${ut} ${this.capitalize(f.name)} { get; set; }\n`;
          }
        }
        content += `    }\n\n`;
      }

      // Include
      content += `    /// <summary>ORM-style eager relation include options for ${name}.</summary>\n`;
      content += `    public class ${name}Include : IAn5Include\n    {\n`;
      for (const rel of model.relations) {
        content += `        public object ${this.capitalize(rel.name)} { get; set; }\n`;
      }
      content += `        public object _count { get; set; }\n`;
      content += `    }\n\n`;

      // FindManyArgs
      content += `    /// <summary>ORM-style args for ${name}.FindMany().</summary>\n`;
      content += `    public class ${name}FindManyArgs : IAn5QueryArgs\n    {\n`;
      content += `        public ${name}WhereInput Where { get; set; }\n`;
      content += `        public ${name}OrderByInput OrderBy { get; set; }\n`;
      content += `        public int? Take { get; set; }\n`;
      content += `        public int? Skip { get; set; }\n`;
      content += `        public List<string> Select { get; set; }\n`;
      content += `        public object Include { get; set; }\n`;
      content += `    }\n\n`;

      // FindFirstArgs
      content += `    /// <summary>ORM-style args for ${name}.FindFirst().</summary>\n`;
      content += `    public class ${name}FindFirstArgs : IAn5QueryArgs\n    {\n`;
      content += `        public ${name}WhereInput Where { get; set; }\n`;
      content += `        public ${name}OrderByInput OrderBy { get; set; }\n`;
      content += `        public List<string> Select { get; set; }\n`;
      content += `        public object Include { get; set; }\n`;
      content += `    }\n\n`;

      // FindUniqueArgs
      content += `    /// <summary>ORM-style args for ${name}.FindUnique().</summary>\n`;
      content += `    public class ${name}FindUniqueArgs : IAn5QueryArgs\n    {\n`;
      content += `        public ${name}WhereInput Where { get; set; }\n`;
      content += `        public List<string> Select { get; set; }\n`;
      content += `        public object Include { get; set; }\n`;
      content += `    }\n\n`;

      // DeleteManyArgs
      if (!model.isView) {
        content += `    /// <summary>ORM-style args for ${name}.DeleteMany().</summary>\n`;
        content += `    public class ${name}DeleteManyArgs : IAn5QueryArgs\n    {\n`;
        content += `        public ${name}WhereInput Where { get; set; }\n`;
        content += `    }\n\n`;
      }

      // CountArgs
      content += `    /// <summary>ORM-style args for ${name}.Count().</summary>\n`;
      content += `    public class ${name}CountArgs : IAn5QueryArgs\n    {\n`;
      content += `        public ${name}WhereInput Where { get; set; }\n`;
      content += `    }\n\n`;

      // Aggregate & GroupBy HAVING inputs
      content += `    /// <summary>Count aggregate filters for ${name}.GroupBy() HAVING clauses.</summary>\n`;
      content += `    public class ${name}CountAggregateFilter\n    {\n`;
      content += `        public IntFilter _all { get; set; }\n`;
      for (const f of model.fields) {
        content += `        public IntFilter ${this.capitalize(f.name)} { get; set; }\n`;
      }
      content += `    }\n\n`;

      content += `    /// <summary>Numeric aggregate filters (sum/avg) for ${name}.GroupBy() HAVING clauses.</summary>\n`;
      content += `    public class ${name}NumericAggregateFilter\n    {\n`;
      for (const f of model.fields) {
        const kind = fieldKind(f, this.provider);
        if (kind === 'int' || kind === 'bigint' || kind === 'float') {
          content += `        public NumberFilter ${this.capitalize(f.name)} { get; set; }\n`;
        }
      }
      content += `    }\n\n`;

      content += `    /// <summary>Scalar aggregate filters (min/max) for ${name}.GroupBy() HAVING clauses.</summary>\n`;
      content += `    public class ${name}ScalarAggregateFilter\n    {\n`;
      for (const f of model.fields) {
        const ft = this.getCsFilterType(f, f.isOptional);
        content += `        public ${ft} ${this.capitalize(f.name)} { get; set; }\n`;
      }
      content += `    }\n\n`;

      content += `    /// <summary>Type-safe HAVING filter for ${name}.GroupBy() queries.</summary>\n`;
      content += `    public class ${name}AggregateHavingInput : IAn5HavingInput\n    {\n`;
      content += `        public List<${name}AggregateHavingInput> AND { get; set; }\n`;
      content += `        public List<${name}AggregateHavingInput> OR { get; set; }\n`;
      content += `        public ${name}AggregateHavingInput NOT { get; set; }\n`;
      content += `        public ${name}CountAggregateFilter _count { get; set; }\n`;
      content += `        public ${name}NumericAggregateFilter _sum { get; set; }\n`;
      content += `        public ${name}NumericAggregateFilter _avg { get; set; }\n`;
      content += `        public ${name}ScalarAggregateFilter _min { get; set; }\n`;
      content += `        public ${name}ScalarAggregateFilter _max { get; set; }\n`;
      for (const f of model.fields) {
        const ft = this.getCsFilterType(f, f.isOptional);
        content += `        public ${ft} ${this.capitalize(f.name)} { get; set; }\n`;
      }
      content += `    }\n\n`;

      content += `    /// <summary>ORM-style args for ${name}.GroupBy().</summary>\n`;
      content += `    public class ${name}GroupByArgs : IAn5GroupByArgs\n    {\n`;
      content += `        public List<string> By { get; set; }\n`;
      content += `        public ${name}WhereInput Where { get; set; }\n`;
      content += `        public ${name}AggregateHavingInput Having { get; set; }\n`;
      content += `        public ${name}OrderByInput OrderBy { get; set; }\n`;
      content += `        public int? Skip { get; set; }\n`;
      content += `        public int? Take { get; set; }\n`;
      content += `        public object Count { get; set; }\n`;
      content += `        public List<string> Sum { get; set; }\n`;
      content += `        public List<string> Avg { get; set; }\n`;
      content += `        public List<string> Min { get; set; }\n`;
      content += `        public List<string> Max { get; set; }\n`;
      content += `    }\n\n`;
    }

    content += `}\n`;

    fs.writeFileSync(path.join(this.outputDir, 'An5OrmTypes.cs'), content);
  }

  private generateConfigClass() {
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
    fs.writeFileSync(path.join(this.outputDir, 'An5Config.cs'), content);
  }

  /**
   * The C# type for a field.
   *
   * Driven by the declared type, so a `DECIMAL` column is a `decimal` and a `FLOAT`
   * one a `double`: both arrived as `number` and took the `int` branch.
   */
  private mapType(field: Field, isOptional: boolean): string {
    let csType: string;
    switch (fieldKind(field, this.provider)) {
      case 'int': csType = 'int'; break;
      case 'bigint': csType = 'long'; break;
      case 'float': {
        // `DECIMAL`/`NUMERIC`/`MONEY` are exact and stay `decimal`; a floating
        // column is a `double`. Both used to arrive as `number` and became `int`.
        const base = (field.sqlType ?? field.type).replace(/\([^)]*\)/g, '').trim().toUpperCase();
        csType = ['DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY'].includes(base) ? 'decimal' : 'double';
        break;
      }
      case 'bool': csType = 'bool'; break;
      case 'date': {
        const base = (field.sqlType ?? field.type).replace(/\([^)]*\)/g, '').trim().toUpperCase();
        csType = base === 'DATETIMEOFFSET' ? 'DateTimeOffset' : base === 'TIME' ? 'TimeSpan' : 'DateTime';
        break;
      }
      case 'bytes': csType = 'byte[]'; break;
      case 'vector': csType = 'float[]'; break;
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

  private generateEntityClass(model: Model) {
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
        } else {
          content += `        public ${rel.type} ${this.capitalize(rel.name)} { get; set; }\n`;
        }
      }
    }

    content += `\n        // ── Relation counts (populated via Include._count) ───────────────────\n`;
    content += `        public Dictionary<string, int> _count { get; set; }\n`;

    content += `    }
}
`;

    fs.writeFileSync(path.join(this.outputDir, `${model.name}.cs`), content);
  }

  private generateDbContext(models: Model[]) {
    let content = `// This file is auto-generated. Do not edit directly.
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.Linq;
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
            p.Value = Bindable(value) ?? DBNull.Value;
            cmd.Parameters.Add(p);
            return p;
        }

        /// <summary>
        /// Converts a value into something the provider can bind.
        /// </summary>
        /// <remarks>
        /// A <c>VECTOR(n)</c> column is transmitted as a JSON array over TDS, so a float or
        /// double array is written in that form. The array itself is not bindable: the
        /// provider has no mapping for it, and the failure names the array rather than the
        /// column it was meant for.
        /// </remarks>
        public static object Bindable(object value)
        {
            // \`float[]\` and \`double[]\` are listed separately rather than through a shared
            // \`IEnumerable<double>\`: an array of value type is not covariant, so
            // \`float[]\` does not convert to it.
            if (value is float[] floats) return FormatVector(floats.Select(v => (double)v));
            if (value is double[] doubles) return FormatVector(doubles);
            if (value is ReadOnlyMemory<float> rom) return FormatVector(rom.ToArray().Select(v => (double)v));
            if (value is Memory<float> mem) return FormatVector(mem.ToArray().Select(v => (double)v));
            if (value is ReadOnlyMemory<double> romD) return FormatVector(romD.ToArray());
            if (value is Memory<double> memD) return FormatVector(memD.ToArray());
            if (value != null && value.GetType().Name.StartsWith("SqlVector"))
            {
                var memProp = value.GetType().GetProperty("Memory");
                if (memProp != null)
                {
                    var memVal = memProp.GetValue(value);
                    if (memVal != null) return Bindable(memVal);
                }
            }
            return value;
        }

        /// <summary>Renders a vector as the JSON array SQL Server expects.</summary>
        public static string FormatVector(IEnumerable<double> vector)
        {
            var parts = new List<string>();
            foreach (var value in vector)
            {
                parts.Add(value.ToString("R", System.Globalization.CultureInfo.InvariantCulture));
            }
            return "[" + string.Join(", ", parts) + "]";
        }

        /// <summary>Quotes an identifier for the dialect.</summary>
        public static string Quote(string name, An5Dialect dialect)
        {
            var raw = StripSegmentWrapping(name);
            if (dialect == An5Dialect.Mssql)
                return "[" + raw.Replace("]", "]]") + "]";
            return "\\"" + raw.Replace("\\"", "\\"\\"") + "\\"";
        }

        private static string StripSegmentWrapping(string name)
        {
            var s = (name ?? "").Trim();
            if (s.Length >= 2 && ((s[0] == '[' && s[s.Length - 1] == ']') || (s[0] == '"' && s[s.Length - 1] == '"') || (s[0] == (char)96 && s[s.Length - 1] == (char)96)))
                return s.Substring(1, s.Length - 2);
            return s;
        }

        public static string QuoteTable(string tableName, An5Dialect dialect)
        {
            var rawParts = (tableName ?? "").Split('.');
            var cleaned = new List<string>(rawParts.Length);
            foreach (var part in rawParts)
            {
                var seg = StripSegmentWrapping(part);
                if (seg.Length > 0) cleaned.Add(seg);
            }
            if (cleaned.Count == 0) return Quote(tableName ?? "", dialect);
            if (dialect == An5Dialect.Sqlite && cleaned.Count == 2 && cleaned[0].Equals("dbo", StringComparison.OrdinalIgnoreCase))
                cleaned.RemoveAt(0);
            return string.Join(".", cleaned.ConvertAll(p => Quote(p, dialect)));
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

    /// <summary>Relation definition emitted from schema metadata.</summary>
    public class An5RelationDef
    {
        public string ModelName { get; set; }
        public string RelationType { get; set; }
        public string ForeignKey { get; set; }
        public string LocalKey { get; set; }
    }

    /// <summary>Generated model-to-table, field, and relation metadata.</summary>
    public static class An5ClientMetadata
    {
        public static readonly Dictionary<string, string> ModelToTable = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
${(() => {
  const seen = new Set<string>();
  return models.flatMap(m => {
    const fullTable = dottedTableName(m);
    return this.getAllPropertyVariations(m.name)
      .filter(prop => { const l = prop.toLowerCase(); if (seen.has(l)) return false; seen.add(l); return true; })
      .map(prop => `            { "${prop}", "${fullTable}" },`);
  }).join('\n');
})()}
        };

        public static readonly Dictionary<string, Dictionary<string, string>> ModelFields = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase)
        {
${(() => {
  const seenModel = new Set<string>();
  return models.flatMap(m => {
    const fieldPairs: string[] = [];
    const seen = new Set<string>();
    for (const f of m.fields) {
      for (const alias of [f.name, this.toSnakeCase(f.name), this.capitalize(f.name)]) {
        const lower = alias.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          fieldPairs.push(`{ "${alias}", "${f.name}" }`);
        }
      }
    }
    const dictBody = fieldPairs.join(', ');
    return this.getAllPropertyVariations(m.name)
      .filter(prop => { const l = prop.toLowerCase(); if (seenModel.has(l)) return false; seenModel.add(l); return true; })
      .map(prop => `            { "${prop}", new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ${dictBody} } },`);
  }).join('\n');
})()}
        };

        public static readonly Dictionary<string, Dictionary<string, An5RelationDef>> RelationMap = new Dictionary<string, Dictionary<string, An5RelationDef>>(StringComparer.OrdinalIgnoreCase)
        {
${(() => {
  const seenModel = new Set<string>();
  return models.flatMap(m => {
    const relEntries = m.relations.map(rel => {
      const target = this.capitalize(rel.type);
      const relType = rel.isArray ? 'many' : 'one';
      const fk = rel.foreignKey || 'id';
      const lk = rel.localKey || 'id';
      return `{ "${rel.name}", new An5RelationDef { ModelName = "${target}", RelationType = "${relType}", ForeignKey = "${fk}", LocalKey = "${lk}" } }`;
    }).join(', ');
    return this.getAllPropertyVariations(m.name)
      .filter(prop => { const l = prop.toLowerCase(); if (seenModel.has(l)) return false; seenModel.add(l); return true; })
      .map(prop => `            { "${prop}", new Dictionary<string, An5RelationDef>(StringComparer.OrdinalIgnoreCase) { ${relEntries} } },`);
  }).join('\n');
})()}
        };

        public static string ToSnakeCase(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new System.Text.StringBuilder(s.Length + 4);
            for (int i = 0; i < s.Length; i++)
            {
                var ch = s[i];
                if (ch >= 'A' && ch <= 'Z')
                {
                    if (i > 0)
                    {
                        var prev = s[i - 1];
                        var hasNextLower = i + 1 < s.Length && s[i + 1] >= 'a' && s[i + 1] <= 'z';
                        var prevIsUpper = prev >= 'A' && prev <= 'Z';
                        if (prev != '_' && (!prevIsUpper || hasNextLower))
                            sb.Append('_');
                    }
                    sb.Append(char.ToLowerInvariant(ch));
                }
                else
                {
                    sb.Append(ch);
                }
            }
            return sb.ToString();
        }

        public static string ResolveTable(string modelName)
        {
            if (string.IsNullOrEmpty(modelName)) return modelName ?? "";
            return ModelToTable.TryGetValue(modelName, out var tbl) ? tbl : modelName;
        }

        public static bool ModelHasFields(string modelName)
        {
            return !string.IsNullOrEmpty(modelName)
                && ModelFields.TryGetValue(modelName, out var map)
                && map.Count > 0;
        }

        public static bool ModelHasField(string modelName, string col)
        {
            return TryResolveColumn(modelName, col, out _);
        }

        public static bool TryResolveColumn(string modelName, string col, out string resolved)
        {
            resolved = col;
            if (string.IsNullOrEmpty(modelName) || string.IsNullOrEmpty(col)) return false;
            if (!ModelFields.TryGetValue(modelName, out var map) || map.Count == 0) return false;
            if (map.TryGetValue(col, out var direct))
            {
                resolved = direct;
                return true;
            }
            var snake = ToSnakeCase(col);
            if (map.TryGetValue(snake, out var bySnake))
            {
                resolved = bySnake;
                return true;
            }
            return false;
        }

        public static string ResolveColumn(string modelName, string col)
        {
            return TryResolveColumn(modelName, col, out var resolved) ? resolved : col;
        }

        public static bool ResolveRelationEntry(string modelName, string relKey, out string canonicalKey, out An5RelationDef relation)
        {
            canonicalKey = null;
            relation = null;
            if (string.IsNullOrEmpty(modelName) || string.IsNullOrEmpty(relKey)) return false;
            if (!RelationMap.TryGetValue(modelName, out var rels) || rels.Count == 0) return false;
            foreach (var kv in rels)
            {
                if (string.Equals(kv.Key, relKey, StringComparison.OrdinalIgnoreCase))
                {
                    canonicalKey = kv.Key;
                    relation = kv.Value;
                    return true;
                }
            }
            var snake = ToSnakeCase(relKey);
            foreach (var kv in rels)
            {
                if (string.Equals(ToSnakeCase(kv.Key), snake, StringComparison.OrdinalIgnoreCase))
                {
                    canonicalKey = kv.Key;
                    relation = kv.Value;
                    return true;
                }
            }
            return false;
        }

        public static bool ResolveRelation(string modelName, string relKey, out An5RelationDef relation)
        {
            return ResolveRelationEntry(modelName, relKey, out _, out relation);
        }

        public static (string ChildCol, string ParentCol) ResolveRelationKeys(string parentModel, An5RelationDef rel)
        {
            if (rel == null) return ("id", "id");
            var rawFK = string.IsNullOrEmpty(rel.ForeignKey) ? "id" : rel.ForeignKey;
            var rawLK = string.IsNullOrEmpty(rel.LocalKey) ? "id" : rel.LocalKey;
            if (rel.RelationType == "many")
                return (ResolveColumn(rel.ModelName, rawFK), ResolveColumn(parentModel, rawLK));
            if ((ModelHasField(rel.ModelName, rawFK) && !ModelHasField(rel.ModelName, rawLK))
                || (ModelHasField(parentModel, rawLK) && !ModelHasField(parentModel, rawFK)))
            {
                return (ResolveColumn(rel.ModelName, rawFK), ResolveColumn(parentModel, rawLK));
            }
            return (ResolveColumn(rel.ModelName, rawLK), ResolveColumn(parentModel, rawFK));
        }
    }

    internal sealed class An5IncludeEntry
    {
        public string CanonicalKey { get; set; }
        public An5RelationDef Relation { get; set; }
        public object SubWhere { get; set; }
        public object SubOrderBy { get; set; }
        public int? SubTake { get; set; }
        public int? SubSkip { get; set; }
        public List<string> SubSelect { get; set; }
        public An5IncludeSpec SubInclude { get; set; }
    }

    internal sealed class An5IncludeSpec
    {
        public Dictionary<string, An5IncludeEntry> Entries { get; } = new Dictionary<string, An5IncludeEntry>(StringComparer.OrdinalIgnoreCase);
        public bool IncludeCount { get; set; }
        public bool CountAll { get; set; }
        public Dictionary<string, object> CountRelations { get; } = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

        public bool HasWork => IncludeCount || Entries.Count > 0;

        public HashSet<string> GetRequiredParentCols(string modelName)
        {
            var required = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in Entries.Values)
            {
                var (_, parentCol) = An5ClientMetadata.ResolveRelationKeys(modelName, entry.Relation);
                if (!string.IsNullOrEmpty(parentCol)) required.Add(parentCol);
            }
            if (IncludeCount && An5ClientMetadata.RelationMap.TryGetValue(modelName, out var rels))
            {
                if (CountAll)
                {
                    foreach (var kv in rels)
                    {
                        if (kv.Value.RelationType != "many") continue;
                        var (_, parentCol) = An5ClientMetadata.ResolveRelationKeys(modelName, kv.Value);
                        if (!string.IsNullOrEmpty(parentCol)) required.Add(parentCol);
                    }
                }
                else
                {
                    foreach (var relName in CountRelations.Keys)
                    {
                        if (An5ClientMetadata.ResolveRelation(modelName, relName, out var rDef) && rDef != null)
                        {
                            var (_, parentCol) = An5ClientMetadata.ResolveRelationKeys(modelName, rDef);
                            if (!string.IsNullOrEmpty(parentCol)) required.Add(parentCol);
                        }
                    }
                }
            }
            return required;
        }
    }

    internal static class An5WhereBuilder
    {
        private static readonly HashSet<string> ScalarOperators = new HashSet<string>(StringComparer.Ordinal)
        { "equals", "in", "notIn", "contains", "startsWith", "endsWith", "not", "gte", "lte", "gt", "lt", "mode" };

        private static readonly HashSet<string> RelationOperators = new HashSet<string>(StringComparer.Ordinal)
        { "some", "none", "every", "is", "isNot", "is_not" };

        private static readonly Dictionary<string, string> AggregateHavingOps = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "_count", "COUNT" },
            { "_sum", "SUM" },
            { "_avg", "AVG" },
            { "_min", "MIN" },
            { "_max", "MAX" },
        };

        internal static string SanitizeIdentifier(string s)
        {
            var sb = new System.Text.StringBuilder((s ?? "").Length);
            foreach (var ch in (s ?? ""))
                sb.Append(char.IsLetterOrDigit(ch) || ch == '_' ? ch : '_');
            var res = sb.ToString();
            return res.Length > 0 && char.IsLetter(res[0]) ? res : "col_" + res;
        }

        private static string SanitizeAlias(string s)
        {
            var sb = new System.Text.StringBuilder((s ?? "").Length);
            foreach (var ch in (s ?? ""))
                sb.Append(char.IsLetterOrDigit(ch) || ch == '_' ? ch : '_');
            var res = sb.ToString();
            return res.Length > 0 && char.IsLetter(res[0]) ? res : "rel_" + res;
        }

        private static bool IsNonScalarCollection(object value)
        {
            if (value == null || value is string || value is byte[]) return false;
            return value is System.Collections.IEnumerable;
        }

        public static string BuildWhere(
            object whereVal,
            string modelName,
            An5Dialect dialect,
            Dictionary<string, object> parameters,
            ref int paramIdx)
        {
            if (whereVal == null) return "";
            if (whereVal is IAn5WhereInput)
                return BuildWhereFromObject(whereVal, modelName, dialect, parameters, ref paramIdx, "", "", "");
            if (whereVal is IDictionary<string, object> wd)
                return BuildWhereFromDict(wd, modelName, dialect, parameters, ref paramIdx, "", "", "");
            throw new ArgumentException($"Unsupported Where payload type '{whereVal.GetType().Name}'.");
        }

        public static string BuildOrderBy(object orderByVal, string modelName, An5Dialect dialect)
        {
            if (orderByVal == null) return "";
            var entries = orderByVal is System.Collections.IList list && !(orderByVal is IDictionary<string, object>) && !(orderByVal is IDictionary<string, string>)
                ? list
                : new object[] { orderByVal };
            var orderParts = new List<string>();
            foreach (var entry in entries)
            {
                if (entry == null) continue;
                if (entry is IDictionary<string, object> dict)
                {
                    foreach (var kv in dict)
                    {
                        if (kv.Value == null) continue;
                        var dirStr = kv.Value.ToString()?.ToUpperInvariant() == "DESC" ? "DESC" : "ASC";
                        var col = An5Provider.Quote(An5ClientMetadata.ResolveColumn(modelName, kv.Key), dialect);
                        orderParts.Add($"{col} {dirStr}");
                    }
                    continue;
                }
                if (entry is IDictionary<string, string> sdict)
                {
                    foreach (var kv in sdict)
                    {
                        if (string.IsNullOrEmpty(kv.Value)) continue;
                        var dirStr = kv.Value.ToUpperInvariant() == "DESC" ? "DESC" : "ASC";
                        var col = An5Provider.Quote(An5ClientMetadata.ResolveColumn(modelName, kv.Key), dialect);
                        orderParts.Add($"{col} {dirStr}");
                    }
                    continue;
                }
                foreach (var prop in entry.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    var dirObj = prop.GetValue(entry);
                    if (dirObj == null) continue;
                    var dirStr = dirObj.ToString()?.ToUpperInvariant() == "DESC" ? "DESC" : "ASC";
                    var col = An5Provider.Quote(An5ClientMetadata.ResolveColumn(modelName, prop.Name), dialect);
                    orderParts.Add($"{col} {dirStr}");
                }
            }
            return orderParts.Count > 0 ? "ORDER BY " + string.Join(", ", orderParts) : "";
        }

        public static string BuildHaving(
            object havingVal,
            string modelName,
            An5Dialect dialect,
            List<string> resolvedByCols,
            Dictionary<string, object> parameters,
            ref int paramIdx)
        {
            if (havingVal == null) return "";
            var bySet = new HashSet<string>(resolvedByCols ?? new List<string>(), StringComparer.OrdinalIgnoreCase);
            if (havingVal is IAn5HavingInput)
                return BuildHavingFromObject(havingVal, modelName, dialect, bySet, parameters, ref paramIdx);
            if (havingVal is IDictionary<string, object> hd)
                return BuildHavingFromDict(hd, modelName, dialect, bySet, parameters, ref paramIdx);
            throw new ArgumentException($"Unsupported Having payload type '{havingVal.GetType().Name}'.");
        }

        private static readonly HashSet<string> QueryEnvelopeKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "where", "orderBy", "take", "skip", "select", "include" };

        private static bool IsPocoContainer(object val)
        {
            if (val == null || val is string || val is byte[] || val is ValueType) return false;
            if (val is System.Collections.IEnumerable) return false;
            if (val is IAn5QueryArgs || val is IAn5WhereInput || val is IAn5HavingInput || val is IAn5GroupByArgs) return false;
            return true;
        }

        private static List<KeyValuePair<string, object>> ReadKeyValueEntries(object container, string errContext, bool skipNulls)
        {
            var entries = new List<KeyValuePair<string, object>>();
            if (container is System.Collections.IDictionary dict)
            {
                foreach (System.Collections.DictionaryEntry de in dict)
                {
                    if (!(de.Key is string keyStr) || string.IsNullOrWhiteSpace(keyStr))
                        throw new ArgumentException($"{errContext}: dictionary keys must be non-empty strings.");
                    if (skipNulls && de.Value == null) continue;
                    entries.Add(new KeyValuePair<string, object>(keyStr, de.Value));
                }
                return entries;
            }
            foreach (var prop in container.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (prop.GetIndexParameters().Length > 0) continue;
                var v = prop.GetValue(container);
                if (skipNulls && v == null) continue;
                entries.Add(new KeyValuePair<string, object>(prop.Name, v));
            }
            return entries;
        }

        private static bool IsQueryEnvelopeDict(IDictionary<string, object> dict, string modelName)
        {
            if (dict == null || dict.Count == 0) return false;
            foreach (var k in dict.Keys)
            {
                if (string.IsNullOrEmpty(k) || !QueryEnvelopeKeys.Contains(k)) return false;
                if (!string.IsNullOrEmpty(modelName)
                    && (An5ClientMetadata.ModelHasField(modelName, k) || An5ClientMetadata.ResolveRelation(modelName, k, out _)))
                {
                    return false;
                }
            }
            return true;
        }

        public static List<string> ExtractSelectCols(string modelName, object selectVal)
        {
            if (selectVal == null) return null;
            if (selectVal is IEnumerable<string> selList)
            {
                var cols = new List<string>();
                foreach (var col in selList)
                    if (!string.IsNullOrEmpty(col))
                        cols.Add(An5ClientMetadata.ResolveColumn(modelName, col));
                return cols;
            }
            if (selectVal is System.Collections.IDictionary selDict)
            {
                var cols = new List<string>();
                foreach (System.Collections.DictionaryEntry de in selDict)
                {
                    if (!(de.Key is string colKey) || string.IsNullOrWhiteSpace(colKey))
                        throw new ArgumentException("Select dictionary keys must be non-empty strings.");
                    if (de.Value != null && Convert.ToBoolean(de.Value))
                        cols.Add(An5ClientMetadata.ResolveColumn(modelName, colKey));
                }
                return cols;
            }
            if (selectVal is System.Collections.IEnumerable selEnum && !(selectVal is string))
            {
                var cols = new List<string>();
                foreach (var item in selEnum)
                {
                    var s = item?.ToString();
                    if (!string.IsNullOrEmpty(s))
                        cols.Add(An5ClientMetadata.ResolveColumn(modelName, s));
                }
                return cols;
            }
            throw new ArgumentException($"Unsupported Select payload type '{selectVal.GetType().Name}'.");
        }

        private static void ParseCountPayload(string modelName, object countVal, An5IncludeSpec spec)
        {
            if (countVal == null) return;
            if (countVal is bool cb)
            {
                if (cb)
                {
                    spec.IncludeCount = true;
                    spec.CountAll = true;
                }
                return;
            }
            if (!(countVal is System.Collections.IDictionary) && !IsPocoContainer(countVal))
                throw new ArgumentException($"Unsupported _count payload type '{countVal.GetType().Name}' for model '{modelName}'.");

            var rawEntries = ReadKeyValueEntries(countVal, $"_count on '{modelName}'", false);
            List<KeyValuePair<string, object>> targetEntries = rawEntries;

            foreach (var kv in rawEntries)
            {
                if (string.Equals(kv.Key, "select", StringComparison.OrdinalIgnoreCase))
                {
                    if (rawEntries.Count > 1)
                        throw new ArgumentException($"Unknown option alongside 'select' in _count for model '{modelName}'.");
                    if (kv.Value == null || (!(kv.Value is System.Collections.IDictionary) && !IsPocoContainer(kv.Value)))
                        throw new ArgumentException($"_count.select for model '{modelName}' must be a map of relation names.");
                    targetEntries = ReadKeyValueEntries(kv.Value, $"_count.select on '{modelName}'", false);
                    break;
                }
            }

            spec.IncludeCount = true;
            spec.CountAll = false;

            foreach (var kv in targetEntries)
            {
                if (!An5ClientMetadata.ResolveRelationEntry(modelName, kv.Key, out var canonRel, out var rDef))
                    throw new ArgumentException($"Unknown relation '{kv.Key}' in _count for model '{modelName}'.");
                if (kv.Value == null) continue;
                if (kv.Value is bool rb)
                {
                    if (rb) spec.CountRelations[canonRel] = null;
                    continue;
                }
                if (!(kv.Value is System.Collections.IDictionary) && !IsPocoContainer(kv.Value))
                    throw new ArgumentException($"Unsupported _count option type '{kv.Value.GetType().Name}' for relation '{kv.Key}' on '{modelName}'.");

                object countWhere = null;
                foreach (var opt in ReadKeyValueEntries(kv.Value, $"_count.{kv.Key} on '{modelName}'", true))
                {
                    if (!string.Equals(opt.Key, "where", StringComparison.OrdinalIgnoreCase))
                        throw new ArgumentException($"Unknown _count option '{opt.Key}' for relation '{kv.Key}' on '{modelName}'.");
                    countWhere = opt.Value;
                }
                if (countWhere != null)
                {
                    int dummyIdx = 0;
                    BuildWhere(countWhere, rDef.ModelName, An5Dialect.Sqlite, new Dictionary<string, object>(), ref dummyIdx);
                }
                spec.CountRelations[canonRel] = countWhere;
            }
        }

        private static An5IncludeEntry ParseRelationIncludeOption(string parentModel, string canonKey, An5RelationDef rel, object val)
        {
            if (val is bool rb)
            {
                if (!rb) return null;
                return new An5IncludeEntry { CanonicalKey = canonKey, Relation = rel };
            }
            if (val is IAn5Include)
            {
                return new An5IncludeEntry
                {
                    CanonicalKey = canonKey,
                    Relation = rel,
                    SubInclude = ParseIncludeSpec(rel.ModelName, val),
                };
            }
            if (!(val is System.Collections.IDictionary) && !(val is IAn5QueryArgs) && !IsPocoContainer(val))
                throw new ArgumentException($"Unsupported Include option type '{val.GetType().Name}' for relation '{canonKey}' on '{parentModel}'.");

            object subWhere = null;
            object subOrderBy = null;
            int? subTake = null;
            int? subSkip = null;
            List<string> subSelect = null;
            object subIncludeRaw = null;

            bool isDict = val is System.Collections.IDictionary;
            var optEntries = ReadKeyValueEntries(val, $"Include.{canonKey} on '{parentModel}'", true);
            foreach (var opt in optEntries)
            {
                var k = opt.Key;
                var ov = opt.Value;
                if (string.Equals(k, "where", StringComparison.OrdinalIgnoreCase))
                {
                    subWhere = ov;
                }
                else if (string.Equals(k, "orderBy", StringComparison.OrdinalIgnoreCase))
                {
                    subOrderBy = ov;
                }
                else if (string.Equals(k, "take", StringComparison.OrdinalIgnoreCase))
                {
                    int t = Convert.ToInt32(ov);
                    if (t < 0) throw new ArgumentException($"Include.take for relation '{canonKey}' on '{parentModel}' cannot be negative.");
                    subTake = t;
                }
                else if (string.Equals(k, "skip", StringComparison.OrdinalIgnoreCase))
                {
                    int s = Convert.ToInt32(ov);
                    if (s < 0) throw new ArgumentException($"Include.skip for relation '{canonKey}' on '{parentModel}' cannot be negative.");
                    subSkip = s;
                }
                else if (string.Equals(k, "select", StringComparison.OrdinalIgnoreCase))
                {
                    subSelect = ExtractSelectCols(rel.ModelName, ov);
                }
                else if (string.Equals(k, "include", StringComparison.OrdinalIgnoreCase))
                {
                    subIncludeRaw = ov;
                }
                else if (isDict || !(val is IAn5QueryArgs))
                {
                    throw new ArgumentException($"Unknown Include option '{k}' for relation '{canonKey}' on '{parentModel}'.");
                }
            }

            if (subWhere != null)
            {
                int dummyIdx = 0;
                BuildWhere(subWhere, rel.ModelName, An5Dialect.Sqlite, new Dictionary<string, object>(), ref dummyIdx);
            }

            return new An5IncludeEntry
            {
                CanonicalKey = canonKey,
                Relation = rel,
                SubWhere = subWhere,
                SubOrderBy = subOrderBy,
                SubTake = subTake,
                SubSkip = subSkip,
                SubSelect = subSelect,
                SubInclude = ParseIncludeSpec(rel.ModelName, subIncludeRaw),
            };
        }

        internal static An5IncludeSpec ParseIncludeSpec(string modelName, object includeVal)
        {
            if (includeVal == null) return null;
            if (!(includeVal is IAn5Include) && !(includeVal is System.Collections.IDictionary) && !IsPocoContainer(includeVal))
                throw new ArgumentException($"Unsupported Include payload type '{includeVal.GetType().Name}' for model '{modelName}'.");

            var spec = new An5IncludeSpec();
            var skipNulls = !(includeVal is System.Collections.IDictionary);
            foreach (var kv in ReadKeyValueEntries(includeVal, $"Include on '{modelName}'", skipNulls))
            {
                if (string.Equals(kv.Key, "_count", StringComparison.OrdinalIgnoreCase))
                {
                    ParseCountPayload(modelName, kv.Value, spec);
                    continue;
                }
                if (!An5ClientMetadata.ResolveRelationEntry(modelName, kv.Key, out var canonKey, out var rel))
                    throw new ArgumentException($"Unknown relation '{kv.Key}' in Include for model '{modelName}'.");
                if (kv.Value == null) continue;
                var entry = ParseRelationIncludeOption(modelName, canonKey, rel, kv.Value);
                if (entry != null) spec.Entries[canonKey] = entry;
                else spec.Entries.Remove(canonKey);
            }
            return spec;
        }

        public static string BuildColumnInCondition(
            string modelName,
            string colName,
            List<object> values,
            An5Dialect dialect,
            Dictionary<string, object> parameters,
            ref int paramIdx)
        {
            if (values == null || values.Count == 0) return "1=0";
            var quotedCol = An5Provider.Quote(An5ClientMetadata.ResolveColumn(modelName, colName), dialect);
            var phs = new List<string>(values.Count);
            foreach (var v in values)
                phs.Add(AddParam(parameters, ref paramIdx, v));
            return $"{quotedCol} IN ({string.Join(", ", phs)})";
        }

        public static void ParseArgs(
            object args,
            string modelName,
            An5Dialect dialect,
            out string whereSql,
            out string orderBySql,
            out int? take,
            out int? skip,
            out List<string> selectCols,
            out Dictionary<string, object> parameters)
        {
            ParseArgs(args, modelName, dialect, out whereSql, out orderBySql, out take, out skip, out selectCols, out _, out parameters);
        }

        public static void ParseArgs(
            object args,
            string modelName,
            An5Dialect dialect,
            out string whereSql,
            out string orderBySql,
            out int? take,
            out int? skip,
            out List<string> selectCols,
            out object includeVal,
            out Dictionary<string, object> parameters)
        {
            whereSql = "";
            orderBySql = "";
            take = null;
            skip = null;
            selectCols = null;
            includeVal = null;
            parameters = new Dictionary<string, object>();
            if (args == null) return;

            int paramIdx = 0;
            if (args is IAn5WhereInput)
            {
                whereSql = BuildWhereFromObject(args, modelName, dialect, parameters, ref paramIdx, "", "", "");
                return;
            }
            if (args is IDictionary<string, object> rawDict)
            {
                if (IsQueryEnvelopeDict(rawDict, modelName))
                {
                    foreach (var kv in rawDict)
                    {
                        if (kv.Value == null) continue;
                        if (string.Equals(kv.Key, "where", StringComparison.OrdinalIgnoreCase))
                            whereSql = BuildWhere(kv.Value, modelName, dialect, parameters, ref paramIdx);
                        else if (string.Equals(kv.Key, "orderBy", StringComparison.OrdinalIgnoreCase))
                            orderBySql = BuildOrderBy(kv.Value, modelName, dialect);
                        else if (string.Equals(kv.Key, "take", StringComparison.OrdinalIgnoreCase))
                            take = Convert.ToInt32(kv.Value);
                        else if (string.Equals(kv.Key, "skip", StringComparison.OrdinalIgnoreCase))
                            skip = Convert.ToInt32(kv.Value);
                        else if (string.Equals(kv.Key, "select", StringComparison.OrdinalIgnoreCase))
                            selectCols = ExtractSelectCols(modelName, kv.Value);
                        else if (string.Equals(kv.Key, "include", StringComparison.OrdinalIgnoreCase))
                            includeVal = kv.Value;
                    }
                    return;
                }
                whereSql = BuildWhereFromDict(rawDict, modelName, dialect, parameters, ref paramIdx, "", "", "");
                return;
            }

            var argType = args.GetType();
            var hasWhereProp = argType.GetProperty("Where", BindingFlags.Public | BindingFlags.Instance) != null;
            var hasOrderProp = argType.GetProperty("OrderBy", BindingFlags.Public | BindingFlags.Instance) != null;
            var hasTakeProp = argType.GetProperty("Take", BindingFlags.Public | BindingFlags.Instance) != null;
            var hasSkipProp = argType.GetProperty("Skip", BindingFlags.Public | BindingFlags.Instance) != null;
            var hasSelectProp = argType.GetProperty("Select", BindingFlags.Public | BindingFlags.Instance) != null;
            var hasIncludeProp = argType.GetProperty("Include", BindingFlags.Public | BindingFlags.Instance) != null;
            if (!(args is IAn5QueryArgs) && !hasWhereProp && !hasOrderProp && !hasTakeProp && !hasSkipProp && !hasSelectProp && !hasIncludeProp)
                throw new ArgumentException($"Unsupported query args type '{argType.Name}'.");

            var whereVal = argType.GetProperty("Where", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            whereSql = BuildWhere(whereVal, modelName, dialect, parameters, ref paramIdx);

            var orderByVal = argType.GetProperty("OrderBy", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            orderBySql = BuildOrderBy(orderByVal, modelName, dialect);

            var takeVal = argType.GetProperty("Take", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            if (takeVal != null) take = Convert.ToInt32(takeVal);

            var skipVal = argType.GetProperty("Skip", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            if (skipVal != null) skip = Convert.ToInt32(skipVal);

            var selectVal = argType.GetProperty("Select", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            if (selectVal != null) selectCols = ExtractSelectCols(modelName, selectVal);

            includeVal = argType.GetProperty("Include", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
        }

        private static string AddParam(Dictionary<string, object> parameters, ref int paramIdx, object value)
        {
            var name = "p_" + (paramIdx++);
            parameters[name] = value;
            return "@" + name;
        }

        private static string BuildWhereFromObject(
            object whereObj,
            string modelName,
            An5Dialect dialect,
            Dictionary<string, object> parameters,
            ref int paramIdx,
            string prefix,
            string selfRef,
            string colPrefix)
        {
            if (whereObj == null) return "";
            if (whereObj is IDictionary<string, object> dict)
                return BuildWhereFromDict(dict, modelName, dialect, parameters, ref paramIdx, prefix, selfRef, colPrefix);

            var parts = new List<string>();
            var props = whereObj.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance);
            foreach (var prop in props)
            {
                var val = prop.GetValue(whereObj);
                if (val == null) continue;
                var name = prop.Name;

                if (name == "AND" && val is System.Collections.IList andList)
                {
                    var subs = new List<string>();
                    int idx = 0;
                    foreach (var item in andList)
                    {
                        if (item == null) continue;
                        var sub = BuildWhereFromObject(item, modelName, dialect, parameters, ref paramIdx, $"{prefix}AND{idx++}_", selfRef, colPrefix);
                        if (!string.IsNullOrEmpty(sub)) subs.Add(sub);
                    }
                    if (subs.Count > 0) parts.Add("(" + string.Join(" AND ", subs) + ")");
                    continue;
                }
                if (name == "OR" && val is System.Collections.IList orList)
                {
                    var subs = new List<string>();
                    int idx = 0;
                    foreach (var item in orList)
                    {
                        if (item == null) continue;
                        var sub = BuildWhereFromObject(item, modelName, dialect, parameters, ref paramIdx, $"{prefix}OR{idx++}_", selfRef, colPrefix);
                        subs.Add(string.IsNullOrEmpty(sub) ? "1=1" : sub);
                    }
                    parts.Add(subs.Count > 0 ? "(" + string.Join(" OR ", subs) + ")" : "1=0");
                    continue;
                }
                if (name == "NOT")
                {
                    var sub = BuildWhereFromObject(val, modelName, dialect, parameters, ref paramIdx, $"{prefix}NOT_", selfRef, colPrefix);
                    parts.Add("NOT (" + (string.IsNullOrEmpty(sub) ? "1=1" : sub) + ")");
                    continue;
                }

                if (val is IListRelationFilter lrf)
                {
                    if (!An5ClientMetadata.ResolveRelation(modelName, name, out var rel))
                        throw new ArgumentException($"Relation metadata not found for '{name}' on '{modelName}'.");
                    if (rel.RelationType != "many")
                        throw new ArgumentException($"Relation '{name}' on '{modelName}' is to-one and cannot use ListRelationFilter.");

                    var childTable = An5Provider.QuoteTable(An5ClientMetadata.ResolveTable(rel.ModelName), dialect);
                    var (childKey, parentKey) = An5ClientMetadata.ResolveRelationKeys(modelName, rel);
                    var childCol = An5Provider.Quote(childKey, dialect);
                    var parentCol = An5Provider.Quote(parentKey, dialect);
                    var parentRef = !string.IsNullOrEmpty(selfRef)
                        ? $"{selfRef}."
                        : $"{An5Provider.QuoteTable(An5ClientMetadata.ResolveTable(modelName), dialect)}.";
                    var relSnake = An5ClientMetadata.ToSnakeCase(name);

                    foreach (var entry in new (string Op, object Target)[] { ("some", lrf.SomeTarget), ("none", lrf.NoneTarget), ("every", lrf.EveryTarget) })
                    {
                        if (entry.Target == null) continue;
                        var childAlias = "r_" + SanitizeAlias($"{prefix}{relSnake}_{entry.Op}");
                        var correlation = $"{childAlias}.{childCol} = {parentRef}{parentCol}";
                        var inner = BuildWhereFromObject(entry.Target, rel.ModelName, dialect, parameters, ref paramIdx, $"{prefix}{relSnake}_{entry.Op}_", childAlias, $"{childAlias}.");
                        if (entry.Op == "some")
                        {
                            var innerClause = string.IsNullOrEmpty(inner) ? "" : $" AND ({inner})";
                            parts.Add($"EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{innerClause})");
                        }
                        else if (entry.Op == "none")
                        {
                            var innerClause = string.IsNullOrEmpty(inner) ? "" : $" AND ({inner})";
                            parts.Add($"NOT EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{innerClause})");
                        }
                        else
                        {
                            var violated = string.IsNullOrEmpty(inner) ? " AND 1=0" : $" AND NOT ({inner})";
                            parts.Add($"NOT EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{violated})");
                        }
                    }
                    continue;
                }

                if (val is IRelationFilter rf)
                {
                    if (!An5ClientMetadata.ResolveRelation(modelName, name, out var rel))
                        throw new ArgumentException($"Relation metadata not found for '{name}' on '{modelName}'.");
                    if (rel.RelationType != "one")
                        throw new ArgumentException($"Relation '{name}' on '{modelName}' is to-many and cannot use RelationFilter.");
                    if (rf.IsTarget != null && rf.IsNull)
                        throw new ArgumentException($"Relation filter '{name}' cannot set both Is and IsNull.");
                    if (rf.IsNotTarget != null && rf.IsNotNull)
                        throw new ArgumentException($"Relation filter '{name}' cannot set both IsNot and IsNotNull.");

                    var childTable = An5Provider.QuoteTable(An5ClientMetadata.ResolveTable(rel.ModelName), dialect);
                    var (childKey, parentKey) = An5ClientMetadata.ResolveRelationKeys(modelName, rel);
                    var childCol = An5Provider.Quote(childKey, dialect);
                    var parentCol = An5Provider.Quote(parentKey, dialect);
                    var parentRef = !string.IsNullOrEmpty(selfRef)
                        ? $"{selfRef}."
                        : $"{An5Provider.QuoteTable(An5ClientMetadata.ResolveTable(modelName), dialect)}.";
                    var relSnake = An5ClientMetadata.ToSnakeCase(name);

                    if (rf.IsTarget != null)
                    {
                        var childAlias = "r_" + SanitizeAlias($"{prefix}{relSnake}_is");
                        var correlation = $"{childAlias}.{childCol} = {parentRef}{parentCol}";
                        var inner = BuildWhereFromObject(rf.IsTarget, rel.ModelName, dialect, parameters, ref paramIdx, $"{prefix}{relSnake}_is_", childAlias, $"{childAlias}.");
                        var innerClause = string.IsNullOrEmpty(inner) ? "" : $" AND ({inner})";
                        parts.Add($"EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{innerClause})");
                    }
                    else if (rf.IsNull)
                    {
                        var childAlias = "r_" + SanitizeAlias($"{prefix}{relSnake}_is");
                        var correlation = $"{childAlias}.{childCol} = {parentRef}{parentCol}";
                        parts.Add($"NOT EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation})");
                    }

                    if (rf.IsNotTarget != null)
                    {
                        var childAlias = "r_" + SanitizeAlias($"{prefix}{relSnake}_isNot");
                        var correlation = $"{childAlias}.{childCol} = {parentRef}{parentCol}";
                        var inner = BuildWhereFromObject(rf.IsNotTarget, rel.ModelName, dialect, parameters, ref paramIdx, $"{prefix}{relSnake}_isNot_", childAlias, $"{childAlias}.");
                        var innerClause = string.IsNullOrEmpty(inner) ? "" : $" AND ({inner})";
                        parts.Add($"NOT EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{innerClause})");
                    }
                    else if (rf.IsNotNull)
                    {
                        var childAlias = "r_" + SanitizeAlias($"{prefix}{relSnake}_isNot");
                        var correlation = $"{childAlias}.{childCol} = {parentRef}{parentCol}";
                        parts.Add($"EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation})");
                    }
                    continue;
                }

                var col = colPrefix + An5Provider.Quote(An5ClientMetadata.ResolveColumn(modelName, name), dialect);
                AppendTypedFilter(parts, col, name, val, parameters, ref paramIdx);
            }
            return string.Join(" AND ", parts);
        }

        private static string BuildHavingFromObject(
            object havingObj,
            string modelName,
            An5Dialect dialect,
            HashSet<string> bySet,
            Dictionary<string, object> parameters,
            ref int paramIdx)
        {
            if (havingObj == null) return "";
            if (havingObj is IDictionary<string, object> dict)
                return BuildHavingFromDict(dict, modelName, dialect, bySet, parameters, ref paramIdx);

            var parts = new List<string>();
            foreach (var prop in havingObj.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var val = prop.GetValue(havingObj);
                if (val == null) continue;
                var name = prop.Name;

                if (name == "AND" && val is System.Collections.IList andList)
                {
                    var subs = new List<string>();
                    foreach (var item in andList)
                    {
                        if (item == null) continue;
                        var sub = BuildHavingFromObject(item, modelName, dialect, bySet, parameters, ref paramIdx);
                        if (!string.IsNullOrEmpty(sub)) subs.Add(sub);
                    }
                    if (subs.Count > 0) parts.Add("(" + string.Join(" AND ", subs) + ")");
                    continue;
                }
                if (name == "OR" && val is System.Collections.IList orList)
                {
                    var subs = new List<string>();
                    foreach (var item in orList)
                    {
                        if (item == null) continue;
                        var sub = BuildHavingFromObject(item, modelName, dialect, bySet, parameters, ref paramIdx);
                        subs.Add(string.IsNullOrEmpty(sub) ? "1=1" : sub);
                    }
                    parts.Add(subs.Count > 0 ? "(" + string.Join(" OR ", subs) + ")" : "1=0");
                    continue;
                }
                if (name == "NOT")
                {
                    if (val is System.Collections.IList notList)
                    {
                        var subs = new List<string>();
                        foreach (var item in notList)
                        {
                            if (item == null) continue;
                            var sub = BuildHavingFromObject(item, modelName, dialect, bySet, parameters, ref paramIdx);
                            subs.Add(string.IsNullOrEmpty(sub) ? "1=1" : sub);
                        }
                        if (subs.Count > 0) parts.Add("NOT (" + string.Join(" OR ", subs) + ")");
                    }
                    else
                    {
                        var sub = BuildHavingFromObject(val, modelName, dialect, bySet, parameters, ref paramIdx);
                        parts.Add("NOT (" + (string.IsNullOrEmpty(sub) ? "1=1" : sub) + ")");
                    }
                    continue;
                }

                if (AggregateHavingOps.TryGetValue(name, out var sqlFn))
                {
                    foreach (var aggProp in val.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                    {
                        var aggVal = aggProp.GetValue(val);
                        if (aggVal == null) continue;
                        string expr;
                        if (aggProp.Name == "_all")
                        {
                            if (name != "_count")
                                throw new ArgumentException($"'_all' is only valid inside '_count' having filter, not '{name}'.");
                            expr = "COUNT(*)";
                        }
                        else
                        {
                            var resolvedCol = An5ClientMetadata.ResolveColumn(modelName, aggProp.Name);
                            expr = $"{sqlFn}({An5Provider.Quote(resolvedCol, dialect)})";
                        }
                        AppendTypedFilter(parts, expr, $"{name}.{aggProp.Name}", aggVal, parameters, ref paramIdx);
                    }
                    continue;
                }

                var scalarCol = An5ClientMetadata.ResolveColumn(modelName, name);
                if (!bySet.Contains(scalarCol))
                    throw new ArgumentException($"Field '{name}' in having clause must be included in 'by' fields or wrapped in an aggregate filter (_count, _sum, _avg, _min, _max).");
                AppendTypedFilter(parts, An5Provider.Quote(scalarCol, dialect), name, val, parameters, ref paramIdx);
            }
            return string.Join(" AND ", parts);
        }

        private static string BuildHavingFromDict(
            IDictionary<string, object> dict,
            string modelName,
            An5Dialect dialect,
            HashSet<string> bySet,
            Dictionary<string, object> parameters,
            ref int paramIdx)
        {
            if (dict == null || dict.Count == 0) return "";
            var keys = new List<string>(dict.Keys);
            keys.Sort(StringComparer.Ordinal);
            var parts = new List<string>();
            foreach (var key in keys)
            {
                var value = dict[key];
                if (key == "AND" || key == "OR" || key == "NOT")
                {
                    var p = parameters;
                    var bSet = bySet;
                    var nextIdx = paramIdx;
                    var logical = BuildDictLogicalCondition(key, value, subMap =>
                        BuildHavingFromDict(subMap, modelName, dialect, bSet, p, ref nextIdx));
                    paramIdx = nextIdx;
                    if (!string.IsNullOrEmpty(logical)) parts.Add(logical);
                    continue;
                }

                if (AggregateHavingOps.TryGetValue(key, out var sqlFn))
                {
                    if (!(value is IDictionary<string, object> aggDict))
                        throw new ArgumentException($"'{key}' having filter must be a dictionary.");
                    var aggKeys = new List<string>(aggDict.Keys);
                    aggKeys.Sort(StringComparer.Ordinal);
                    foreach (var field in aggKeys)
                    {
                        string expr;
                        if (field == "_all")
                        {
                            if (key != "_count")
                                throw new ArgumentException($"'_all' is only valid inside '_count' having filter, not '{key}'.");
                            expr = "COUNT(*)";
                        }
                        else
                        {
                            if (!string.IsNullOrEmpty(modelName) && An5ClientMetadata.ModelHasFields(modelName) && !An5ClientMetadata.ModelHasField(modelName, field))
                                throw new ArgumentException($"Unknown field '{field}' on model '{modelName}' in '{key}' having filter.");
                            var resolvedCol = An5ClientMetadata.ResolveColumn(modelName, field);
                            expr = $"{sqlFn}({An5Provider.Quote(resolvedCol, dialect)})";
                        }
                        parts.AddRange(BuildDictFieldConditions(expr, $"{key}.{field}", aggDict[field], parameters, ref paramIdx));
                    }
                    continue;
                }

                if (!string.IsNullOrEmpty(modelName) && An5ClientMetadata.ModelHasFields(modelName) && !An5ClientMetadata.ModelHasField(modelName, key))
                    throw new ArgumentException($"Unknown field '{key}' on model '{modelName}' in having clause.");
                var scalarCol = An5ClientMetadata.ResolveColumn(modelName, key);
                if (!bySet.Contains(scalarCol))
                    throw new ArgumentException($"Field '{key}' in having clause must be included in 'by' fields or wrapped in an aggregate filter (_count, _sum, _avg, _min, _max).");
                parts.AddRange(BuildDictFieldConditions(An5Provider.Quote(scalarCol, dialect), key, value, parameters, ref paramIdx));
            }
            return string.Join(" AND ", parts);
        }

        private static void AppendTypedFilter(List<string> parts, string col, string name, object val, Dictionary<string, object> parameters, ref int paramIdx)
        {
            switch (val)
            {
                case StringFilter sf:
                    AppendStringFilter(parts, col, name, sf, parameters, ref paramIdx);
                    break;
                case IntFilter inf:
                    AppendComparableFilter(parts, col, inf.Equals, inf.Not, inf.Gt, inf.Gte, inf.Lt, inf.Lte, inf.In, inf.NotIn, parameters, ref paramIdx);
                    break;
                case NumberFilter nf:
                    AppendComparableFilter(parts, col, nf.Equals, nf.Not, nf.Gt, nf.Gte, nf.Lt, nf.Lte, nf.In, nf.NotIn, parameters, ref paramIdx);
                    break;
                case BoolFilter bf:
                    if (bf.Equals.HasValue) parts.Add($"{col} = {AddParam(parameters, ref paramIdx, bf.Equals.Value)}");
                    if (bf.Not.HasValue) parts.Add($"{col} <> {AddParam(parameters, ref paramIdx, bf.Not.Value)}");
                    break;
                case DateTimeFilter df:
                    AppendComparableFilter(parts, col, df.Equals, df.Not, df.Gt, df.Gte, df.Lt, df.Lte, df.In, df.NotIn, parameters, ref paramIdx);
                    break;
                case string s:
                case bool _:
                case int _:
                case long _:
                case double _:
                case float _:
                case decimal _:
                case DateTime _:
                case Guid _:
                    parts.Add($"{col} = {AddParam(parameters, ref paramIdx, val)}");
                    break;
                default:
                    throw new ArgumentException($"Unsupported filter field type '{val.GetType().Name}' for '{name}'.");
            }
        }

        private static void AppendStringFilter(List<string> parts, string col, string fieldName, StringFilter f, Dictionary<string, object> parameters, ref int paramIdx)
        {
            if (f == null) return;
            var insensitive = false;
            if (!string.IsNullOrEmpty(f.Mode))
            {
                if (f.Mode != "default" && f.Mode != "insensitive")
                    throw new ArgumentException($"Invalid filter mode '{f.Mode}' for field '{fieldName}'.");
                insensitive = f.Mode == "insensitive";
            }

            if (f.Equals != null)
            {
                var p = AddParam(parameters, ref paramIdx, f.Equals);
                parts.Add(insensitive ? $"LOWER({col}) = LOWER({p})" : $"{col} = {p}");
            }
            if (f.Not != null)
            {
                var p = AddParam(parameters, ref paramIdx, f.Not);
                parts.Add(insensitive ? $"LOWER({col}) <> LOWER({p})" : $"{col} <> {p}");
            }
            if (f.Contains != null)
            {
                var p = AddParam(parameters, ref paramIdx, $"%{f.Contains}%");
                parts.Add(insensitive ? $"LOWER({col}) LIKE LOWER({p})" : $"{col} LIKE {p}");
            }
            if (f.StartsWith != null)
            {
                var p = AddParam(parameters, ref paramIdx, $"{f.StartsWith}%");
                parts.Add(insensitive ? $"LOWER({col}) LIKE LOWER({p})" : $"{col} LIKE {p}");
            }
            if (f.EndsWith != null)
            {
                var p = AddParam(parameters, ref paramIdx, $"%{f.EndsWith}");
                parts.Add(insensitive ? $"LOWER({col}) LIKE LOWER({p})" : $"{col} LIKE {p}");
            }
            if (f.Gt != null) parts.Add($"{col} > {AddParam(parameters, ref paramIdx, f.Gt)}");
            if (f.Gte != null) parts.Add($"{col} >= {AddParam(parameters, ref paramIdx, f.Gte)}");
            if (f.Lt != null) parts.Add($"{col} < {AddParam(parameters, ref paramIdx, f.Lt)}");
            if (f.Lte != null) parts.Add($"{col} <= {AddParam(parameters, ref paramIdx, f.Lte)}");
            AppendInFilter(parts, col, "IN", "1=0", f.In, parameters, ref paramIdx, insensitive);
            AppendInFilter(parts, col, "NOT IN", "1=1", f.NotIn, parameters, ref paramIdx, insensitive);
        }

        private static void AppendComparableFilter<TVal>(
            List<string> parts,
            string col,
            TVal? eq,
            TVal? not,
            TVal? gt,
            TVal? gte,
            TVal? lt,
            TVal? lte,
            List<TVal> inList,
            List<TVal> notInList,
            Dictionary<string, object> parameters,
            ref int paramIdx) where TVal : struct
        {
            if (eq.HasValue) parts.Add($"{col} = {AddParam(parameters, ref paramIdx, eq.Value)}");
            if (not.HasValue) parts.Add($"{col} <> {AddParam(parameters, ref paramIdx, not.Value)}");
            if (gt.HasValue) parts.Add($"{col} > {AddParam(parameters, ref paramIdx, gt.Value)}");
            if (gte.HasValue) parts.Add($"{col} >= {AddParam(parameters, ref paramIdx, gte.Value)}");
            if (lt.HasValue) parts.Add($"{col} < {AddParam(parameters, ref paramIdx, lt.Value)}");
            if (lte.HasValue) parts.Add($"{col} <= {AddParam(parameters, ref paramIdx, lte.Value)}");
            AppendInFilter(parts, col, "IN", "1=0", inList, parameters, ref paramIdx);
            AppendInFilter(parts, col, "NOT IN", "1=1", notInList, parameters, ref paramIdx);
        }

        private static void AppendInFilter<TVal>(List<string> parts, string col, string opSql, string emptySql, List<TVal> items, Dictionary<string, object> parameters, ref int paramIdx, bool insensitive = false)
        {
            if (items == null) return;
            if (items.Count == 0)
            {
                parts.Add(emptySql);
                return;
            }
            var useLower = insensitive && typeof(TVal) == typeof(string) && items.TrueForAll(v => v != null);
            var phs = new List<string>(items.Count);
            foreach (var item in items)
            {
                var ph = AddParam(parameters, ref paramIdx, item);
                phs.Add(useLower ? $"LOWER({ph})" : ph);
            }
            var lhs = useLower ? $"LOWER({col})" : col;
            parts.Add($"{lhs} {opSql} ({string.Join(", ", phs)})");
        }

        private static string BuildDictLogicalCondition(
            string key,
            object value,
            Func<IDictionary<string, object>, string> recurse)
        {
            if (value == null) throw new ArgumentException($"'{key}' filter payload must not be null.");
            System.Collections.IList list;
            if (key == "OR")
            {
                if (!(value is System.Collections.IList orSeq))
                    throw new ArgumentException("'OR' filter must be a list of dictionaries.");
                list = orSeq;
            }
            else if (value is IDictionary<string, object> singleMap)
            {
                list = new object[] { singleMap };
            }
            else if (value is System.Collections.IList seq)
            {
                list = seq;
            }
            else
            {
                throw new ArgumentException($"'{key}' filter must be a dictionary or list of dictionaries.");
            }

            var subs = new List<string>();
            foreach (var item in list)
            {
                if (!(item is IDictionary<string, object> subMap))
                    throw new ArgumentException($"'{key}' filter entry must be a dictionary.");
                var s = recurse(subMap);
                subs.Add(string.IsNullOrEmpty(s) ? "1=1" : s);
            }
            if (subs.Count == 0)
                return key == "OR" ? "1=0" : "";
            var joiner = key == "AND" ? " AND " : " OR ";
            var negation = key == "NOT" ? "NOT " : "";
            return negation + "(" + string.Join(joiner, subs) + ")";
        }

        private static string BuildWhereFromDict(
            IDictionary<string, object> dict,
            string modelName,
            An5Dialect dialect,
            Dictionary<string, object> parameters,
            ref int paramIdx,
            string prefix,
            string selfRef,
            string colPrefix)
        {
            if (dict == null || dict.Count == 0) return "";
            var keys = new List<string>(dict.Keys);
            keys.Sort(StringComparer.Ordinal);
            var clean = new Dictionary<string, object>();
            foreach (var k in keys)
            {
                var v = dict[k];
                if (k == "AND" || k == "OR" || k == "NOT" || !k.Contains("_"))
                {
                    clean[k] = v;
                    continue;
                }
                if (!string.IsNullOrEmpty(modelName)
                    && (An5ClientMetadata.ResolveRelation(modelName, k, out _) || An5ClientMetadata.ModelHasField(modelName, k)))
                {
                    clean[k] = v;
                    continue;
                }
                if (v is IDictionary<string, object> inner && !HasAnyKey(inner, ScalarOperators) && !HasAnyKey(inner, RelationOperators))
                {
                    var innerKeys = new List<string>(inner.Keys);
                    innerKeys.Sort(StringComparer.Ordinal);
                    foreach (var ik in innerKeys) clean[ik] = inner[ik];
                }
                else
                {
                    clean[k] = v;
                }
            }

            var cleanKeys = new List<string>(clean.Keys);
            cleanKeys.Sort(StringComparer.Ordinal);
            var parts = new List<string>();
            foreach (var key in cleanKeys)
            {
                var value = clean[key];
                if (key == "AND" || key == "OR" || key == "NOT")
                {
                    int idx = 0;
                    var pfx = prefix;
                    var p = parameters;
                    var refSelf = selfRef;
                    var cPfx = colPrefix;
                    var nextIdx = paramIdx;
                    var logical = BuildDictLogicalCondition(key, value, subMap =>
                        BuildWhereFromDict(subMap, modelName, dialect, p, ref nextIdx, $"{pfx}{key}{idx++}_", refSelf, cPfx));
                    paramIdx = nextIdx;
                    if (!string.IsNullOrEmpty(logical)) parts.Add(logical);
                    continue;
                }

                if (!string.IsNullOrEmpty(modelName))
                {
                    if (An5ClientMetadata.ResolveRelation(modelName, key, out var rel))
                    {
                        if (!(value is IDictionary<string, object> relDict))
                            throw new ArgumentException($"Relation filter for '{key}' on '{modelName}' must be a dictionary.");
                        var isMany = rel.RelationType == "many";
                        var norm = new Dictionary<string, object>(StringComparer.Ordinal);
                        var relKeys = new List<string>(relDict.Keys);
                        relKeys.Sort(StringComparer.Ordinal);
                        foreach (var rk in relKeys)
                        {
                            var canonical = rk == "is_not" ? "isNot" : rk;
                            var allowed = isMany
                                ? (canonical == "some" || canonical == "none" || canonical == "every")
                                : (canonical == "is" || canonical == "isNot");
                            if (!allowed)
                                throw new ArgumentException($"Unsupported relation filter operator '{rk}' for relation '{key}'.");
                            norm[canonical] = relDict[rk];
                        }
                        if (norm.Count == 0) continue;

                        var childTable = An5Provider.QuoteTable(An5ClientMetadata.ResolveTable(rel.ModelName), dialect);
                        var (childKey, parentKey) = An5ClientMetadata.ResolveRelationKeys(modelName, rel);
                        var childCol = An5Provider.Quote(childKey, dialect);
                        var parentCol = An5Provider.Quote(parentKey, dialect);
                        var parentRef = !string.IsNullOrEmpty(selfRef)
                            ? $"{selfRef}."
                            : $"{An5Provider.QuoteTable(An5ClientMetadata.ResolveTable(modelName), dialect)}.";
                        var relSnake = An5ClientMetadata.ToSnakeCase(key);

                        if (isMany)
                        {
                            foreach (var op in new[] { "some", "none", "every" })
                            {
                                if (!norm.TryGetValue(op, out var opVal)) continue;
                                if (!(opVal is IDictionary<string, object> innerDict))
                                    throw new ArgumentException($"'{op}' filter on relation '{key}' must be a dictionary.");
                                var childAlias = "r_" + SanitizeAlias($"{prefix}{relSnake}_{op}");
                                var correlation = $"{childAlias}.{childCol} = {parentRef}{parentCol}";
                                var inner = BuildWhereFromDict(innerDict, rel.ModelName, dialect, parameters, ref paramIdx, $"{prefix}{relSnake}_{op}_", childAlias, $"{childAlias}.");
                                if (op == "some")
                                {
                                    var ic = string.IsNullOrEmpty(inner) ? "" : $" AND ({inner})";
                                    parts.Add($"EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{ic})");
                                }
                                else if (op == "none")
                                {
                                    var ic = string.IsNullOrEmpty(inner) ? "" : $" AND ({inner})";
                                    parts.Add($"NOT EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{ic})");
                                }
                                else
                                {
                                    var vw = string.IsNullOrEmpty(inner) ? " AND 1=0" : $" AND NOT ({inner})";
                                    parts.Add($"NOT EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{vw})");
                                }
                            }
                        }
                        else
                        {
                            foreach (var op in new[] { "is", "isNot" })
                            {
                                if (!norm.TryGetValue(op, out var opVal)) continue;
                                var childAlias = "r_" + SanitizeAlias($"{prefix}{relSnake}_{op}");
                                var correlation = $"{childAlias}.{childCol} = {parentRef}{parentCol}";
                                if (opVal == null)
                                {
                                    parts.Add(op == "is"
                                        ? $"NOT EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation})"
                                        : $"EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation})");
                                    continue;
                                }
                                if (!(opVal is IDictionary<string, object> innerDict))
                                    throw new ArgumentException($"'{op}' filter on relation '{key}' must be a dictionary or null.");
                                var inner = BuildWhereFromDict(innerDict, rel.ModelName, dialect, parameters, ref paramIdx, $"{prefix}{relSnake}_{op}_", childAlias, $"{childAlias}.");
                                var ic = string.IsNullOrEmpty(inner) ? "" : $" AND ({inner})";
                                parts.Add(op == "is"
                                    ? $"EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{ic})"
                                    : $"NOT EXISTS (SELECT 1 FROM {childTable} AS {childAlias} WHERE {correlation}{ic})");
                            }
                        }
                        continue;
                    }
                    if (An5ClientMetadata.ModelHasFields(modelName) && !An5ClientMetadata.ModelHasField(modelName, key))
                        throw new ArgumentException($"Unknown field '{key}' on model '{modelName}'.");
                }

                var col = colPrefix + An5Provider.Quote(An5ClientMetadata.ResolveColumn(modelName, key), dialect);
                parts.AddRange(BuildDictFieldConditions(col, key, value, parameters, ref paramIdx));
            }
            return string.Join(" AND ", parts);
        }

        private static bool HasAnyKey(IDictionary<string, object> dict, HashSet<string> targetSet)
        {
            foreach (var k in dict.Keys)
                if (targetSet.Contains(k)) return true;
            return false;
        }

        private static List<string> BuildDictFieldConditions(string col, string key, object value, Dictionary<string, object> parameters, ref int paramIdx, bool inheritedInsensitive = false)
        {
            if (value == null) return new List<string> { $"{col} IS NULL" };
            if (!(value is IDictionary<string, object> opMap))
            {
                if (IsNonScalarCollection(value))
                    throw new ArgumentException($"Filter value for '{key}' must be a scalar value, not a collection.");
                return new List<string> { $"{col} = {AddParam(parameters, ref paramIdx, value)}" };
            }

            var insensitive = inheritedInsensitive;
            if (opMap.TryGetValue("mode", out var modeVal))
            {
                if (!(modeVal is string ms) || (ms != "default" && ms != "insensitive"))
                    throw new ArgumentException($"Invalid filter mode '{modeVal}' for field '{key}'.");
                insensitive = ms == "insensitive";
            }

            var opKeys = new List<string>(opMap.Keys);
            opKeys.Sort(StringComparer.Ordinal);
            var outList = new List<string>();
            foreach (var op in opKeys)
            {
                if (!ScalarOperators.Contains(op))
                    throw new ArgumentException($"Unsupported filter operator '{op}' for field '{key}'.");
                if (op == "mode") continue;

                var val = opMap[op];
                switch (op)
                {
                    case "not":
                        if (val == null) outList.Add($"{col} IS NOT NULL");
                        else if (val is IDictionary<string, object> nested)
                        {
                            var nc = BuildDictFieldConditions(col, key, nested, parameters, ref paramIdx, insensitive);
                            if (nc.Count > 0) outList.Add("NOT (" + string.Join(" AND ", nc) + ")");
                        }
                        else if (IsNonScalarCollection(val))
                        {
                            throw new ArgumentException($"'not' on '{key}' requires a scalar value or operator dictionary.");
                        }
                        else
                        {
                            var p = AddParam(parameters, ref paramIdx, val);
                            outList.Add(insensitive && val is string ? $"LOWER({col}) <> LOWER({p})" : $"{col} <> {p}");
                        }
                        break;
                    case "equals":
                        if (val == null) outList.Add($"{col} IS NULL");
                        else if (val is System.Collections.IDictionary || IsNonScalarCollection(val))
                            throw new ArgumentException($"'equals' on '{key}' requires a scalar value.");
                        else
                        {
                            var p = AddParam(parameters, ref paramIdx, val);
                            outList.Add(insensitive && val is string ? $"LOWER({col}) = LOWER({p})" : $"{col} = {p}");
                        }
                        break;
                    case "contains":
                        if (!(val is string sc)) throw new ArgumentException($"'contains' on '{key}' requires a string.");
                        var pc = AddParam(parameters, ref paramIdx, $"%{sc}%");
                        outList.Add(insensitive ? $"LOWER({col}) LIKE LOWER({pc})" : $"{col} LIKE {pc}");
                        break;
                    case "startsWith":
                        if (!(val is string ss)) throw new ArgumentException($"'startsWith' on '{key}' requires a string.");
                        var ps = AddParam(parameters, ref paramIdx, $"{ss}%");
                        outList.Add(insensitive ? $"LOWER({col}) LIKE LOWER({ps})" : $"{col} LIKE {ps}");
                        break;
                    case "endsWith":
                        if (!(val is string se)) throw new ArgumentException($"'endsWith' on '{key}' requires a string.");
                        var pe = AddParam(parameters, ref paramIdx, $"%{se}");
                        outList.Add(insensitive ? $"LOWER({col}) LIKE LOWER({pe})" : $"{col} LIKE {pe}");
                        break;
                    case "gt":
                    case "gte":
                    case "lt":
                    case "lte":
                    {
                        if (val == null || val is System.Collections.IDictionary || IsNonScalarCollection(val))
                            throw new ArgumentException($"'{op}' on '{key}' requires a scalar value.");
                        var cmp = op == "gt" ? ">" : op == "gte" ? ">=" : op == "lt" ? "<" : "<=";
                        outList.Add($"{col} {cmp} {AddParam(parameters, ref paramIdx, val)}");
                        break;
                    }
                    case "in":
                    case "notIn":
                    {
                        if (val == null || val is string || val is byte[] || val is System.Collections.IDictionary || !(val is System.Collections.IEnumerable seq))
                            throw new ArgumentException($"'{op}' on '{key}' requires a collection.");
                        var items = new List<object>();
                        var allStrings = true;
                        foreach (var item in seq)
                        {
                            if (!(item is string)) allStrings = false;
                            items.Add(item);
                        }
                        if (items.Count == 0)
                        {
                            outList.Add(op == "in" ? "1=0" : "1=1");
                            break;
                        }
                        var useLower = insensitive && allStrings;
                        var phs = new List<string>(items.Count);
                        foreach (var item in items)
                        {
                            var ph = AddParam(parameters, ref paramIdx, item);
                            phs.Add(useLower ? $"LOWER({ph})" : ph);
                        }
                        var lhs = useLower ? $"LOWER({col})" : col;
                        outList.Add(op == "in" ? $"{lhs} IN ({string.Join(", ", phs)})" : $"{lhs} NOT IN ({string.Join(", ", phs)})");
                        break;
                    }
                }
            }
            return outList;
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
      const client = model.isView ? 'ViewClient' : 'TableClient';
      content += `        public ${client}<${model.name}> ${name}s => new ${client}<${model.name}>(ConnectionString, "${dottedTableName(model)}");\n`;
      content += `        public ${client}<${model.name}> ${name} => ${name}s;\n`;
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

    internal interface IAn5RelationTableClient
    {
        System.Collections.IList FetchForInclude(
            string childJoinCol,
            List<object> joinValues,
            object subWhere,
            object subOrderBy,
            List<string> subSelectCols,
            An5IncludeSpec subInclude,
            out PropertyInfo childJoinProp,
            out HashSet<string> tempClearedCols);

        void HydrateIncludes(System.Collections.IList rows, An5IncludeSpec spec);

        void ClearTempColumns(System.Collections.IList rows, HashSet<string> cols);
    }

    public class TableClient<T> : IAn5RelationTableClient where T : new()
    {
        public string ConnectionString { get; }
        public string TableName { get; }
        public string ModelName => typeof(T).Name;
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

        private string BuildFindSql(string whereSql, string orderBySql, int? take, int? skip, List<string> selectCols)
        {
            var cols = selectCols != null && selectCols.Count > 0
                ? string.Join(", ", selectCols.ConvertAll(c => An5Provider.Quote(c, Dialect)))
                : "*";
            var quotedTable = An5Provider.QuoteTable(TableName, Dialect);
            string query;
            if (Dialect == An5Dialect.Postgres || Dialect == An5Dialect.Sqlite)
            {
                query = $"SELECT {cols} FROM {quotedTable}";
                if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
                if (!string.IsNullOrEmpty(orderBySql)) query += $" {orderBySql}";
                if (take.HasValue) query += $" LIMIT {take.Value}";
                else if (skip.HasValue) query += Dialect == An5Dialect.Sqlite ? " LIMIT -1" : " LIMIT ALL";
                if (skip.HasValue) query += $" OFFSET {skip.Value}";
            }
            else if (skip.HasValue)
            {
                query = $"SELECT {cols} FROM {quotedTable}";
                if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
                query += !string.IsNullOrEmpty(orderBySql) ? $" {orderBySql}" : " ORDER BY (SELECT NULL)";
                query += $" OFFSET {skip.Value} ROWS";
                if (take.HasValue) query += $" FETCH NEXT {take.Value} ROWS ONLY";
            }
            else if (take.HasValue)
            {
                query = $"SELECT TOP ({take.Value}) {cols} FROM {quotedTable}";
                if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
                if (!string.IsNullOrEmpty(orderBySql)) query += $" {orderBySql}";
            }
            else
            {
                query = $"SELECT {cols} FROM {quotedTable}";
                if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
                if (!string.IsNullOrEmpty(orderBySql)) query += $" {orderBySql}";
            }
            return query;
        }

        private List<T> ExecuteFindQuery(object args, int? defaultTake)
        {
            An5WhereBuilder.ParseArgs(args, ModelName, Dialect, out var whereSql, out var orderBySql, out var take, out var skip, out var selectCols, out var includeVal, out var parameters);
            var includeSpec = An5WhereBuilder.ParseIncludeSpec(ModelName, includeVal);

            List<string> effectiveSelectCols = selectCols != null ? new List<string>(selectCols) : null;
            HashSet<string> tempAddedCols = null;
            if (effectiveSelectCols != null && effectiveSelectCols.Count > 0 && includeSpec != null && includeSpec.HasWork)
            {
                EnsureJoinColumns(effectiveSelectCols, includeSpec.GetRequiredParentCols(ModelName), out tempAddedCols);
            }

            var effectiveTake = defaultTake.HasValue ? (take ?? defaultTake.Value) : take;
            var query = BuildFindSql(whereSql, orderBySql, effectiveTake, skip, effectiveSelectCols);
            var rows = QueryRaw(query, parameters);

            if (includeSpec != null && includeSpec.HasWork && rows.Count > 0)
            {
                ResolveIncludes(rows, includeSpec);
            }
            if (tempAddedCols != null && tempAddedCols.Count > 0 && rows.Count > 0)
            {
                ClearColumnsOnRows(rows, tempAddedCols);
            }
            return rows;
        }

        public List<T> FindMany(object args)
        {
            if (args == null) return FindMany(null, null);
            if (args is string sqlWhere) return FindMany(sqlWhere, null);
            return ExecuteFindQuery(args, null);
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

        public T FindFirst(object args)
        {
            if (args == null) return FindFirst(null, null);
            if (args is string sqlWhere) return FindFirst(sqlWhere, null);
            var rows = ExecuteFindQuery(args, 1);
            return rows.Count > 0 ? rows[0] : default;
        }

        private static PropertyInfo FindEntityProp(Type entityType, string fieldOrColName)
        {
            if (entityType == null || string.IsNullOrEmpty(fieldOrColName)) return null;
            var props = entityType.GetProperties(BindingFlags.Public | BindingFlags.Instance);
            foreach (var p in props)
            {
                if (string.Equals(p.Name, fieldOrColName, StringComparison.OrdinalIgnoreCase))
                    return p;
            }
            var targetSnake = An5ClientMetadata.ToSnakeCase(fieldOrColName);
            foreach (var p in props)
            {
                if (string.Equals(An5ClientMetadata.ToSnakeCase(p.Name), targetSnake, StringComparison.OrdinalIgnoreCase))
                    return p;
            }
            return null;
        }

        private static object NormalizeJoinKey(object value, Type expectedType = null)
        {
            if (value == null || value == DBNull.Value) return null;
            var underlying = expectedType != null ? (Nullable.GetUnderlyingType(expectedType) ?? expectedType) : null;
            if (underlying == typeof(Guid) && value is string gs && Guid.TryParse(gs, out var parsedGuid))
                return parsedGuid;
            switch (value)
            {
                case sbyte _:
                case byte _:
                case short _:
                case ushort _:
                case int _:
                case uint _:
                case long _:
                    return Convert.ToInt64(value);
                default:
                    return value;
            }
        }

        private void EnsureJoinColumns(List<string> selectCols, IEnumerable<string> requiredCols, out HashSet<string> tempAddedCols)
        {
            tempAddedCols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var req in requiredCols)
            {
                var resolved = An5ClientMetadata.ResolveColumn(ModelName, req);
                var targetSnake = An5ClientMetadata.ToSnakeCase(resolved);
                bool exists = selectCols.Exists(c =>
                    string.Equals(c, resolved, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(An5ClientMetadata.ToSnakeCase(c), targetSnake, StringComparison.OrdinalIgnoreCase));
                if (!exists)
                {
                    selectCols.Add(resolved);
                    tempAddedCols.Add(resolved);
                }
            }
        }

        private static void ClearColumnsOnRows(System.Collections.IEnumerable rows, HashSet<string> cols)
        {
            if (rows == null || cols == null || cols.Count == 0) return;
            var propsToClear = new List<PropertyInfo>();
            foreach (var col in cols)
            {
                var prop = FindEntityProp(typeof(T), col);
                if (prop != null && prop.CanWrite) propsToClear.Add(prop);
            }
            if (propsToClear.Count == 0) return;
            foreach (var row in rows)
            {
                if (row == null) continue;
                foreach (var prop in propsToClear)
                {
                    var defVal = prop.PropertyType.IsValueType ? Activator.CreateInstance(prop.PropertyType) : null;
                    prop.SetValue(row, defVal);
                }
            }
        }

        private static Dictionary<string, int> GetOrInitCountDict(T row)
        {
            var countProp = typeof(T).GetProperty("_count", BindingFlags.Public | BindingFlags.Instance);
            if (countProp == null || !countProp.CanWrite) return null;
            var existing = countProp.GetValue(row) as Dictionary<string, int>;
            if (existing == null)
            {
                existing = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                countProp.SetValue(row, existing);
            }
            return existing;
        }

        private void ResolveCountIncludes(List<T> rows, An5IncludeSpec spec)
        {
            var targets = new List<(string CanonKey, An5RelationDef Relation, object CountWhere)>();
            if (spec.CountAll)
            {
                if (An5ClientMetadata.RelationMap.TryGetValue(ModelName, out var rels))
                {
                    foreach (var kv in rels)
                    {
                        if (kv.Value.RelationType == "many")
                            targets.Add((kv.Key, kv.Value, null));
                    }
                }
            }
            else
            {
                foreach (var kv in spec.CountRelations)
                {
                    if (An5ClientMetadata.ResolveRelationEntry(ModelName, kv.Key, out var canonKey, out var rDef) && rDef != null)
                        targets.Add((canonKey, rDef, kv.Value));
                }
            }

            foreach (var row in rows)
            {
                var dict = GetOrInitCountDict(row);
                if (dict != null)
                {
                    foreach (var t in targets)
                        dict[t.CanonKey] = 0;
                }
            }

            foreach (var t in targets)
            {
                var (childCol, parentCol) = An5ClientMetadata.ResolveRelationKeys(ModelName, t.Relation);
                var parentProp = FindEntityProp(typeof(T), parentCol);
                if (parentProp == null) continue;

                var uniqueRawByNorm = new Dictionary<object, object>();
                foreach (var row in rows)
                {
                    var rawVal = parentProp.GetValue(row);
                    var norm = NormalizeJoinKey(rawVal, parentProp.PropertyType);
                    if (norm != null && !uniqueRawByNorm.ContainsKey(norm))
                        uniqueRawByNorm[norm] = rawVal;
                }
                if (uniqueRawByNorm.Count == 0) continue;

                var parameters = new Dictionary<string, object>();
                int paramIdx = 0;
                var quotedChildCol = An5Provider.Quote(An5ClientMetadata.ResolveColumn(t.Relation.ModelName, childCol), Dialect);
                var childTable = An5Provider.QuoteTable(An5ClientMetadata.ResolveTable(t.Relation.ModelName), Dialect);
                var inSql = An5WhereBuilder.BuildColumnInCondition(t.Relation.ModelName, childCol, new List<object>(uniqueRawByNorm.Values), Dialect, parameters, ref paramIdx);
                var whereSql = inSql;
                if (t.CountWhere != null)
                {
                    var subWhereSql = An5WhereBuilder.BuildWhere(t.CountWhere, t.Relation.ModelName, Dialect, parameters, ref paramIdx);
                    if (!string.IsNullOrEmpty(subWhereSql))
                        whereSql = $"({inSql}) AND ({subWhereSql})";
                }

                var countQuery = $"SELECT {quotedChildCol}, COUNT(*) FROM {childTable} WHERE {whereSql} GROUP BY {quotedChildCol}";
                var countsByKey = new Dictionary<object, int>();

                var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
                try
                {
                    using var cmd = CreateCommand(conn, countQuery);
                    foreach (var kvp in parameters) An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                    using var reader = cmd.ExecuteReader();
                    while (reader.Read())
                    {
                        var normKey = NormalizeJoinKey(reader.IsDBNull(0) ? null : reader.GetValue(0), parentProp.PropertyType);
                        if (normKey != null)
                            countsByKey[normKey] = reader.IsDBNull(1) ? 0 : Convert.ToInt32(reader.GetValue(1));
                    }
                }
                finally
                {
                    if (!isTx) conn.Dispose();
                }

                foreach (var row in rows)
                {
                    var norm = NormalizeJoinKey(parentProp.GetValue(row), parentProp.PropertyType);
                    var count = norm != null && countsByKey.TryGetValue(norm, out var c) ? c : 0;
                    var dict = GetOrInitCountDict(row);
                    if (dict != null) dict[t.CanonKey] = count;
                }
            }
        }

        private void ResolveIncludes(List<T> rows, An5IncludeSpec spec)
        {
            if (rows == null || rows.Count == 0 || spec == null || !spec.HasWork) return;

            if (spec.IncludeCount)
                ResolveCountIncludes(rows, spec);

            foreach (var entry in spec.Entries.Values)
            {
                var relProp = FindEntityProp(typeof(T), entry.CanonicalKey);
                if (relProp == null || !relProp.CanWrite) continue;

                var isMany = entry.Relation.RelationType == "many";
                Type childClrType = null;
                if (relProp.PropertyType.IsGenericType && typeof(System.Collections.IList).IsAssignableFrom(relProp.PropertyType))
                    childClrType = relProp.PropertyType.GetGenericArguments()[0];
                else
                    childClrType = relProp.PropertyType;
                if (childClrType == null) continue;

                var (childCol, parentCol) = An5ClientMetadata.ResolveRelationKeys(ModelName, entry.Relation);
                var parentProp = FindEntityProp(typeof(T), parentCol);

                var uniqueRawByNorm = new Dictionary<object, object>();
                if (parentProp != null)
                {
                    foreach (var row in rows)
                    {
                        var rawVal = parentProp.GetValue(row);
                        var norm = NormalizeJoinKey(rawVal, parentProp.PropertyType);
                        if (norm != null && !uniqueRawByNorm.ContainsKey(norm))
                            uniqueRawByNorm[norm] = rawVal;
                    }
                }

                if (uniqueRawByNorm.Count == 0 || parentProp == null)
                {
                    foreach (var row in rows)
                    {
                        relProp.SetValue(row, isMany ? Activator.CreateInstance(relProp.PropertyType) : null);
                    }
                    continue;
                }

                var childTable = An5ClientMetadata.ResolveTable(entry.Relation.ModelName);
                var childClientObj = Activator.CreateInstance(typeof(TableClient<>).MakeGenericType(childClrType), ConnectionString, childTable);
                var childClient = childClientObj as IAn5RelationTableClient;
                if (childClient == null) continue;

                var children = childClient.FetchForInclude(
                    childCol,
                    new List<object>(uniqueRawByNorm.Values),
                    entry.SubWhere,
                    entry.SubOrderBy,
                    entry.SubSelect,
                    entry.SubInclude,
                    out var childJoinProp,
                    out var childTempCols);

                var grouped = new Dictionary<object, List<object>>();
                if (childJoinProp != null)
                {
                    foreach (var child in children)
                    {
                        var gk = NormalizeJoinKey(childJoinProp.GetValue(child), parentProp.PropertyType);
                        if (gk == null) continue;
                        if (!grouped.TryGetValue(gk, out var bucket))
                        {
                            bucket = new List<object>();
                            grouped[gk] = bucket;
                        }
                        bucket.Add(child);
                    }
                }

                var slicedByKey = new Dictionary<object, List<object>>();
                var survivingType = typeof(List<>).MakeGenericType(childClrType);
                var survivingChildren = Activator.CreateInstance(survivingType) as System.Collections.IList;
                foreach (var kv in grouped)
                {
                    var items = kv.Value;
                    int skipCount = entry.SubSkip ?? 0;
                    var sliced = new List<object>();
                    for (int i = skipCount; i < items.Count; i++)
                    {
                        if (entry.SubTake.HasValue && sliced.Count >= entry.SubTake.Value) break;
                        sliced.Add(items[i]);
                        survivingChildren.Add(items[i]);
                    }
                    slicedByKey[kv.Key] = sliced;
                }

                if (entry.SubInclude != null && entry.SubInclude.HasWork && survivingChildren.Count > 0)
                {
                    childClient.HydrateIncludes(survivingChildren, entry.SubInclude);
                }
                if (childTempCols != null && childTempCols.Count > 0 && survivingChildren.Count > 0)
                {
                    childClient.ClearTempColumns(survivingChildren, childTempCols);
                }

                foreach (var row in rows)
                {
                    var pk = NormalizeJoinKey(parentProp.GetValue(row), parentProp.PropertyType);
                    List<object> matched = null;
                    if (pk != null) slicedByKey.TryGetValue(pk, out matched);
                    if (isMany)
                    {
                        var typedList = Activator.CreateInstance(relProp.PropertyType) as System.Collections.IList;
                        if (matched != null)
                        {
                            foreach (var m in matched) typedList.Add(m);
                        }
                        relProp.SetValue(row, typedList);
                    }
                    else
                    {
                        relProp.SetValue(row, matched != null && matched.Count > 0 ? matched[0] : null);
                    }
                }
            }
        }

        System.Collections.IList IAn5RelationTableClient.FetchForInclude(
            string childJoinCol,
            List<object> joinValues,
            object subWhere,
            object subOrderBy,
            List<string> subSelectCols,
            An5IncludeSpec subInclude,
            out PropertyInfo childJoinProp,
            out HashSet<string> tempClearedCols)
        {
            childJoinProp = FindEntityProp(typeof(T), childJoinCol);
            tempClearedCols = null;
            if (joinValues == null || joinValues.Count == 0) return new List<T>();

            var parameters = new Dictionary<string, object>();
            int paramIdx = 0;
            var inSql = An5WhereBuilder.BuildColumnInCondition(ModelName, childJoinCol, joinValues, Dialect, parameters, ref paramIdx);
            var subWhereSql = An5WhereBuilder.BuildWhere(subWhere, ModelName, Dialect, parameters, ref paramIdx);
            var whereSql = string.IsNullOrEmpty(subWhereSql) ? inSql : $"({inSql}) AND ({subWhereSql})";
            var orderBySql = An5WhereBuilder.BuildOrderBy(subOrderBy, ModelName, Dialect);

            List<string> effectiveSelectCols = subSelectCols != null && subSelectCols.Count > 0 ? new List<string>(subSelectCols) : null;
            if (effectiveSelectCols != null)
            {
                var reqCols = subInclude != null && subInclude.HasWork
                    ? subInclude.GetRequiredParentCols(ModelName)
                    : new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var resolvedJoinCol = An5ClientMetadata.ResolveColumn(ModelName, childJoinCol);
                if (!string.IsNullOrEmpty(resolvedJoinCol)) reqCols.Add(resolvedJoinCol);
                EnsureJoinColumns(effectiveSelectCols, reqCols, out tempClearedCols);
            }

            var query = BuildFindSql(whereSql, orderBySql, null, null, effectiveSelectCols);
            return QueryRaw(query, parameters);
        }

        void IAn5RelationTableClient.HydrateIncludes(System.Collections.IList rows, An5IncludeSpec spec)
        {
            if (rows == null || rows.Count == 0 || spec == null || !spec.HasWork) return;
            var typed = rows as List<T>;
            if (typed == null)
            {
                typed = new List<T>(rows.Count);
                foreach (var r in rows) if (r is T tr) typed.Add(tr);
            }
            ResolveIncludes(typed, spec);
        }

        void IAn5RelationTableClient.ClearTempColumns(System.Collections.IList rows, HashSet<string> cols)
        {
            ClearColumnsOnRows(rows, cols);
        }

        public T FindUnique(object id)
        {
            if (id is IAn5QueryArgs || id is IAn5WhereInput || id is IDictionary<string, object>)
                return FindFirst(id);
            return FindFirst("Id = @id", new Dictionary<string, object> { { "id", id } });
        }

        private static bool IsScalarColumn(PropertyInfo prop)
        {
            var t = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
            if (t.IsPrimitive || t.IsEnum || t.IsValueType) return true;
            if (t == typeof(string) || t == typeof(byte[]) || t == typeof(float[]) || t == typeof(double[])) return true;
            return false;
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
                if (!IsScalarColumn(prop)) continue;
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
                if (!IsScalarColumn(prop)) continue;
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

        public int Count(object args)
        {
            if (args == null) return Count(null, null);
            if (args is string sqlWhere) return Count(sqlWhere, null);
            An5WhereBuilder.ParseArgs(args, ModelName, Dialect, out var whereSql, out _, out _, out _, out _, out var parameters);
            return Count(whereSql, parameters);
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

        public int UpdateMany(string whereClause, Dictionary<string, object> updateData)
            => UpdateMany(whereClause, updateData, null);

        public int UpdateMany(string whereClause, Dictionary<string, object> updateData, Dictionary<string, object> parameters)
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

        public int UpdateMany(object whereArgs, Dictionary<string, object> updateData)
        {
            if (whereArgs is string sqlWhere) return UpdateMany(sqlWhere, updateData, null);
            An5WhereBuilder.ParseArgs(whereArgs, ModelName, Dialect, out var whereSql, out _, out _, out _, out _, out var parameters);
            return UpdateMany(whereSql, updateData, parameters);
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

        public int DeleteMany(object args)
        {
            if (args == null) return DeleteMany(null, null);
            if (args is string sqlWhere) return DeleteMany(sqlWhere, null);
            An5WhereBuilder.ParseArgs(args, ModelName, Dialect, out var whereSql, out _, out _, out _, out _, out var parameters);
            return DeleteMany(whereSql, parameters);
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
                        if (rawVal is List<double> dblList)
                        {
                            rowVector = dblList;
                        }
                        else
                        {
                            var decoded = DecodeVectorColumn(rawVal);
                            if (decoded != null)
                            {
                                rowVector = new List<double>(decoded.Length);
                                for (int i = 0; i < decoded.Length; i++) rowVector.Add(decoded[i]);
                            }
                            else if (rawVal is string jsonStr)
                            {
                                rowVector = ParseDoubleArray(jsonStr);
                            }
                        }
                    }
                    catch { }
                }

                if (rowVector != null && rowVector.Count == vector.Count)
                {
                    double distance;
                    if (distanceMetric.Equals("euclidean", StringComparison.OrdinalIgnoreCase) || distanceMetric.Equals("l2", StringComparison.OrdinalIgnoreCase))
                    {
                        double sum = 0.0;
                        for (int i = 0; i < vector.Count; i++)
                        {
                            double diff = vector[i] - rowVector[i];
                            sum += diff * diff;
                        }
                        distance = Math.Sqrt(sum);
                    }
                    else if (distanceMetric.Equals("dot", StringComparison.OrdinalIgnoreCase) || distanceMetric.Equals("inner_product", StringComparison.OrdinalIgnoreCase) || distanceMetric.Equals("ip", StringComparison.OrdinalIgnoreCase))
                    {
                        double dot = 0.0;
                        for (int i = 0; i < vector.Count; i++)
                        {
                            dot += vector[i] * rowVector[i];
                        }
                        distance = -dot;
                    }
                    else
                    {
                        double sim = CosineSimilarity(vector, rowVector);
                        distance = 1.0 - sim;
                    }
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

        public Dictionary<string, object> Aggregate(
            string whereClause = null,
            Dictionary<string, object> parameters = null,
            bool count = false,
            List<string> sum = null,
            List<string> avg = null,
            List<string> min = null,
            List<string> max = null)
        {
            var selectParts = new List<string>();
            if (count) selectParts.Add("COUNT(*) AS _count");
            if (sum != null) foreach (var col in sum) selectParts.Add($"SUM({An5Provider.Quote(col, Dialect)}) AS _sum_{col}");
            if (avg != null) foreach (var col in avg) selectParts.Add($"AVG({An5Provider.Quote(col, Dialect)}) AS _avg_{col}");
            if (min != null) foreach (var col in min) selectParts.Add($"MIN({An5Provider.Quote(col, Dialect)}) AS _min_{col}");
            if (max != null) foreach (var col in max) selectParts.Add($"MAX({An5Provider.Quote(col, Dialect)}) AS _max_{col}");
            if (selectParts.Count == 0) selectParts.Add("COUNT(*) AS _count");

            var query = $"SELECT {string.Join(", ", selectParts)} FROM {TableName}";
            if (!string.IsNullOrEmpty(whereClause)) query += $" WHERE {whereClause}";

            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using var cmd = CreateCommand(conn, query);
                if (parameters != null)
                {
                    foreach (var kvp in parameters) An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                }
                using var reader = cmd.ExecuteReader();
                var result = new Dictionary<string, object>();
                if (reader.Read())
                {
                    for (int i = 0; i < reader.FieldCount; i++)
                    {
                        var name = reader.GetName(i);
                        var val = reader[i];
                        result[name] = val != DBNull.Value ? val : null;
                    }
                }
                return result;
            }
            finally { if (!isTx) conn.Dispose(); }
        }

        public List<Dictionary<string, object>> GroupBy(
            List<string> by,
            string whereClause = null,
            Dictionary<string, object> parameters = null,
            List<string> sum = null,
            List<string> avg = null,
            List<string> min = null,
            List<string> max = null,
            string havingClause = null,
            string orderByClause = null,
            int? skip = null,
            int? take = null,
            object count = null)
        {
            if (by == null || by.Count == 0) throw new ArgumentException("GroupBy requires at least one column in 'by'");
            var byCols = by.Select(c => An5Provider.Quote(c, Dialect)).ToList();
            var selectParts = new List<string>(byCols);
            if (!(count is bool bCount && !bCount))
            {
                selectParts.Add("COUNT(*) AS _count");
                if (count != null && !(count is bool))
                {
                    foreach (var cf in ExtractAggFields(count, "_count", false))
                        if (cf != "_all") selectParts.Add($"COUNT({An5Provider.Quote(cf, Dialect)}) AS _count_{An5WhereBuilder.SanitizeIdentifier(cf)}");
                }
            }
            if (sum != null) foreach (var col in sum) selectParts.Add($"SUM({An5Provider.Quote(col, Dialect)}) AS _sum_{col}");
            if (avg != null) foreach (var col in avg) selectParts.Add($"AVG({An5Provider.Quote(col, Dialect)}) AS _avg_{col}");
            if (min != null) foreach (var col in min) selectParts.Add($"MIN({An5Provider.Quote(col, Dialect)}) AS _min_{col}");
            if (max != null) foreach (var col in max) selectParts.Add($"MAX({An5Provider.Quote(col, Dialect)}) AS _max_{col}");

            var query = $"SELECT {string.Join(", ", selectParts)} FROM {TableName}";
            if (!string.IsNullOrEmpty(whereClause)) query += $" WHERE {whereClause}";
            query += $" GROUP BY {string.Join(", ", byCols)}";
            if (!string.IsNullOrEmpty(havingClause)) query += $" HAVING {havingClause}";
            if (!string.IsNullOrEmpty(orderByClause)) query += $" {orderByClause}";
            else if (skip.HasValue || take.HasValue) query += $" ORDER BY {string.Join(", ", byCols)}";
            if (skip.HasValue || take.HasValue)
            {
                if (Dialect == An5Dialect.Postgres || Dialect == An5Dialect.Sqlite)
                {
                    if (take.HasValue) query += $" LIMIT {take.Value}";
                    else if (skip.HasValue) query += Dialect == An5Dialect.Sqlite ? " LIMIT -1" : " LIMIT ALL";
                    if (skip.HasValue) query += $" OFFSET {skip.Value}";
                }
                else
                {
                    query += $" OFFSET {skip ?? 0} ROWS";
                    if (take.HasValue) query += $" FETCH NEXT {take.Value} ROWS ONLY";
                }
            }

            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using var cmd = CreateCommand(conn, query);
                if (parameters != null)
                {
                    foreach (var kvp in parameters) An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                }
                using var reader = cmd.ExecuteReader();
                var rows = new List<Dictionary<string, object>>();
                while (reader.Read())
                {
                    var row = new Dictionary<string, object>();
                    for (int i = 0; i < reader.FieldCount; i++)
                    {
                        var name = reader.GetName(i);
                        var val = reader[i];
                        row[name] = val != DBNull.Value ? val : null;
                    }
                    rows.Add(row);
                }
                return rows;
            }
            finally { if (!isTx) conn.Dispose(); }
        }

        public List<Dictionary<string, object>> GroupBy(object args)
        {
            if (args == null) throw new ArgumentException("GroupBy requires 'by' fields.");
            if (args is List<string> legacyBy) return GroupBy(legacyBy, null, null, null, null, null, null);

            object byVal = null;
            object whereVal = null;
            object havingVal = null;
            object orderByVal = null;
            int? skip = null;
            int? take = null;
            object countVal = null;
            object sumVal = null;
            object avgVal = null;
            object minVal = null;
            object maxVal = null;

            if (args is IDictionary<string, object> argDict)
            {
                argDict.TryGetValue("by", out byVal);
                argDict.TryGetValue("where", out whereVal);
                argDict.TryGetValue("having", out havingVal);
                argDict.TryGetValue("orderBy", out orderByVal);
                if (argDict.TryGetValue("skip", out var sv) && sv != null) skip = Convert.ToInt32(sv);
                if (argDict.TryGetValue("take", out var tv) && tv != null) take = Convert.ToInt32(tv);
                if (!argDict.TryGetValue("_count", out countVal)) argDict.TryGetValue("count", out countVal);
                if (!argDict.TryGetValue("_sum", out sumVal)) argDict.TryGetValue("sum", out sumVal);
                if (!argDict.TryGetValue("_avg", out avgVal)) argDict.TryGetValue("avg", out avgVal);
                if (!argDict.TryGetValue("_min", out minVal)) argDict.TryGetValue("min", out minVal);
                if (!argDict.TryGetValue("_max", out maxVal)) argDict.TryGetValue("max", out maxVal);
            }
            else
            {
                var t = args.GetType();
                var byProp = t.GetProperty("By", BindingFlags.Public | BindingFlags.Instance);
                if (!(args is IAn5GroupByArgs) && byProp == null)
                    throw new ArgumentException($"Unsupported GroupBy args type '{t.Name}'.");
                byVal = byProp?.GetValue(args);
                whereVal = t.GetProperty("Where", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
                havingVal = t.GetProperty("Having", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
                orderByVal = t.GetProperty("OrderBy", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
                var sv = t.GetProperty("Skip", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
                if (sv != null) skip = Convert.ToInt32(sv);
                var tv = t.GetProperty("Take", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
                if (tv != null) take = Convert.ToInt32(tv);
                countVal = t.GetProperty("Count", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
                sumVal = t.GetProperty("Sum", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
                avgVal = t.GetProperty("Avg", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
                minVal = t.GetProperty("Min", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
                maxVal = t.GetProperty("Max", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            }

            var byFields = new List<string>();
            if (byVal is string singleBy && !string.IsNullOrEmpty(singleBy))
            {
                byFields.Add(singleBy);
            }
            else if (byVal != null && !(byVal is System.Collections.IDictionary) && byVal is System.Collections.IEnumerable bySeq)
            {
                foreach (var item in bySeq)
                    if (item is string s && !string.IsNullOrEmpty(s)) byFields.Add(s);
            }
            if (byFields.Count == 0) throw new ArgumentException("GroupBy requires at least one field in 'by'.");

            var resolvedByCols = new List<string>(byFields.Count);
            foreach (var f in byFields)
            {
                if (An5ClientMetadata.ModelHasFields(ModelName) && !An5ClientMetadata.ModelHasField(ModelName, f))
                    throw new ArgumentException($"Unknown field '{f}' on model '{ModelName}' in groupBy 'by'.");
                resolvedByCols.Add(An5ClientMetadata.ResolveColumn(ModelName, f));
            }

            var countFields = ExtractAggFields(countVal, "_count", true);
            var sumFields = ExtractAggFields(sumVal, "_sum", true);
            var avgFields = ExtractAggFields(avgVal, "_avg", true);
            var minFields = ExtractAggFields(minVal, "_min", true);
            var maxFields = ExtractAggFields(maxVal, "_max", true);

            var parameters = new Dictionary<string, object>();
            int paramIdx = 0;
            var whereSql = An5WhereBuilder.BuildWhere(whereVal, ModelName, Dialect, parameters, ref paramIdx);
            var havingSql = An5WhereBuilder.BuildHaving(havingVal, ModelName, Dialect, resolvedByCols, parameters, ref paramIdx);
            var orderBySql = An5WhereBuilder.BuildOrderBy(orderByVal, ModelName, Dialect);

            var byCols = resolvedByCols.ConvertAll(c => An5Provider.Quote(c, Dialect));
            var selectParts = new List<string>(byCols);
            var includeCount = !(countVal is bool cbFalse && !cbFalse);
            var perFieldCount = countFields.Count > 0;
            if (includeCount) selectParts.Add("COUNT(*) AS _count");
            foreach (var cf in countFields)
            {
                if (cf == "_all") continue;
                var rc = An5ClientMetadata.ResolveColumn(ModelName, cf);
                selectParts.Add($"COUNT({An5Provider.Quote(rc, Dialect)}) AS _count_{An5WhereBuilder.SanitizeIdentifier(cf)}");
            }
            foreach (var sf in sumFields)
            {
                var rc = An5ClientMetadata.ResolveColumn(ModelName, sf);
                selectParts.Add($"SUM({An5Provider.Quote(rc, Dialect)}) AS _sum_{An5WhereBuilder.SanitizeIdentifier(sf)}");
            }
            foreach (var af in avgFields)
            {
                var rc = An5ClientMetadata.ResolveColumn(ModelName, af);
                selectParts.Add($"AVG({An5Provider.Quote(rc, Dialect)}) AS _avg_{An5WhereBuilder.SanitizeIdentifier(af)}");
            }
            foreach (var nf in minFields)
            {
                var rc = An5ClientMetadata.ResolveColumn(ModelName, nf);
                selectParts.Add($"MIN({An5Provider.Quote(rc, Dialect)}) AS _min_{An5WhereBuilder.SanitizeIdentifier(nf)}");
            }
            foreach (var xf in maxFields)
            {
                var rc = An5ClientMetadata.ResolveColumn(ModelName, xf);
                selectParts.Add($"MAX({An5Provider.Quote(rc, Dialect)}) AS _max_{An5WhereBuilder.SanitizeIdentifier(xf)}");
            }

            var quotedTable = An5Provider.QuoteTable(TableName, Dialect);
            var query = $"SELECT {string.Join(", ", selectParts)} FROM {quotedTable}";
            if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
            query += $" GROUP BY {string.Join(", ", byCols)}";
            if (!string.IsNullOrEmpty(havingSql)) query += $" HAVING {havingSql}";
            if (!string.IsNullOrEmpty(orderBySql)) query += $" {orderBySql}";
            else if (skip.HasValue || take.HasValue) query += $" ORDER BY {string.Join(", ", byCols)}";
            if (skip.HasValue || take.HasValue)
            {
                if (Dialect == An5Dialect.Postgres || Dialect == An5Dialect.Sqlite)
                {
                    if (take.HasValue) query += $" LIMIT {take.Value}";
                    else if (skip.HasValue) query += Dialect == An5Dialect.Sqlite ? " LIMIT -1" : " LIMIT ALL";
                    if (skip.HasValue) query += $" OFFSET {skip.Value}";
                }
                else
                {
                    query += $" OFFSET {skip ?? 0} ROWS";
                    if (take.HasValue) query += $" FETCH NEXT {take.Value} ROWS ONLY";
                }
            }

            var rawRows = new List<Dictionary<string, object>>();
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using var cmd = CreateCommand(conn, query);
                foreach (var kvp in parameters) An5Provider.Bind(cmd, kvp.Key, kvp.Value);
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var row = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 0; i < reader.FieldCount; i++)
                    {
                        var val = reader[i];
                        row[reader.GetName(i)] = val != DBNull.Value ? val : null;
                    }
                    rawRows.Add(row);
                }
            }
            finally { if (!isTx) conn.Dispose(); }

            var reshaped = new List<Dictionary<string, object>>(rawRows.Count);
            foreach (var raw in rawRows)
            {
                var item = new Dictionary<string, object>();
                for (int i = 0; i < byFields.Count; i++)
                    item[byFields[i]] = raw.TryGetValue(resolvedByCols[i], out var bv) ? bv : null;
                if (perFieldCount)
                {
                    var cmap = new Dictionary<string, object>();
                    cmap["_all"] = raw.TryGetValue("_count", out var ac) && ac != null ? Convert.ToInt64(ac) : 0L;
                    foreach (var cf in countFields)
                    {
                        if (cf == "_all") continue;
                        cmap[cf] = raw.TryGetValue("_count_" + An5WhereBuilder.SanitizeIdentifier(cf), out var fc) && fc != null ? Convert.ToInt64(fc) : 0L;
                    }
                    item["_count"] = cmap;
                }
                else if (includeCount)
                {
                    item["_count"] = raw.TryGetValue("_count", out var ac) && ac != null ? Convert.ToInt64(ac) : 0L;
                }
                AddAggSectionResult(item, raw, "sum", sumFields);
                AddAggSectionResult(item, raw, "avg", avgFields);
                AddAggSectionResult(item, raw, "min", minFields);
                AddAggSectionResult(item, raw, "max", maxFields);
                reshaped.Add(item);
            }
            return reshaped;
        }

        private static void AddAggSectionResult(Dictionary<string, object> item, Dictionary<string, object> raw, string opKey, List<string> fields)
        {
            if (fields == null || fields.Count == 0) return;
            var sub = new Dictionary<string, object>();
            foreach (var f in fields)
            {
                var key = "_" + opKey + "_" + An5WhereBuilder.SanitizeIdentifier(f);
                sub[f] = raw.TryGetValue(key, out var val) ? val : null;
            }
            item["_" + opKey] = sub;
        }

        private List<string> ExtractAggFields(object spec, string section, bool validateModel)
        {
            var result = new List<string>();
            if (spec == null || spec is bool) return result;

            var candidates = new List<string>();
            if (spec is string single && !string.IsNullOrEmpty(single))
            {
                candidates.Add(single);
            }
            else if (spec is IDictionary<string, bool> bdict)
            {
                foreach (var kv in bdict) if (kv.Value) candidates.Add(kv.Key);
            }
            else if (spec is IDictionary<string, object> odict)
            {
                foreach (var kv in odict) if (kv.Value is bool b && b) candidates.Add(kv.Key);
            }
            else if (spec is System.Collections.IEnumerable seq)
            {
                foreach (var item in seq) if (item is string s && !string.IsNullOrEmpty(s)) candidates.Add(s);
            }
            else
            {
                var props = spec.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance);
                if (props.Length == 0)
                    throw new ArgumentException($"Unsupported '{section}' specification type '{spec.GetType().Name}'.");
                foreach (var p in props)
                    if (p.GetValue(spec) is bool pb && pb) candidates.Add(p.Name);
            }

            foreach (var f in candidates)
            {
                if (f == "_all")
                {
                    if (section != "_count")
                        throw new ArgumentException($"'_all' is only valid inside '_count' aggregate, not '{section}'.");
                    result.Add(f);
                    continue;
                }
                if (validateModel && An5ClientMetadata.ModelHasFields(ModelName) && !An5ClientMetadata.ModelHasField(ModelName, f))
                    throw new ArgumentException($"Unknown field '{f}' on model '{ModelName}' in '{section}'.");
                result.Add(f);
            }
            return result;
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
        /// <summary>
        /// Reads a stored vector into the \`float[]\` an entity declares.
        /// </summary>
        /// <remarks>
        /// A \`VECTOR(n)\` column arrives as a JSON array over TDS, so the JSON form is
        /// what is parsed. A float32 BLOB is also accepted because that is what the SQLite
        /// provider stores in the same column. Returns <c>null</c> for anything else, which
        /// leaves the property at its default rather than aborting the whole read.
        /// </remarks>
        private static float[] DecodeVectorColumn(object value)
        {
            if (value is float[] already) return already;
            if (value is double[] asDouble)
            {
                var fromDouble = new float[asDouble.Length];
                for (int i = 0; i < asDouble.Length; i++) fromDouble[i] = (float)asDouble[i];
                return fromDouble;
            }
            if (value is ReadOnlyMemory<float> rom) return rom.ToArray();
            if (value is Memory<float> mem) return mem.ToArray();
            if (value is ReadOnlyMemory<double> romD)
            {
                var arr = romD.ToArray();
                var fromDouble = new float[arr.Length];
                for (int i = 0; i < arr.Length; i++) fromDouble[i] = (float)arr[i];
                return fromDouble;
            }
            if (value is Memory<double> memD)
            {
                var arr = memD.ToArray();
                var fromDouble = new float[arr.Length];
                for (int i = 0; i < arr.Length; i++) fromDouble[i] = (float)arr[i];
                return fromDouble;
            }
            if (value != null && value.GetType().Name.StartsWith("SqlVector"))
            {
                var memProp = value.GetType().GetProperty("Memory");
                if (memProp != null)
                {
                    var memVal = memProp.GetValue(value);
                    if (memVal != null) return DecodeVectorColumn(memVal);
                }
            }

            string text = value as string;
            byte[] bytes = value as byte[];
            if (bytes != null && bytes.Length > 0 && bytes[0] != (byte)'[' && bytes.Length % 4 == 0)
            {
                var fromBlob = new float[bytes.Length / 4];
                for (int i = 0; i < fromBlob.Length; i++)
                {
                    int offset = i * 4;
                    uint bits = (uint)(bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24));
                    fromBlob[i] = BitConverter.ToSingle(BitConverter.GetBytes(bits), 0);
                }
                return fromBlob;
            }
            if (text == null && bytes != null)
            {
                text = System.Text.Encoding.UTF8.GetString(bytes);
            }
            if (text == null) return null;

            var open = text.IndexOf('[');
            var close = text.LastIndexOf(']');
            if (open < 0 || close <= open) return null;
            var body = text.Substring(open + 1, close - open - 1).Trim();
            if (body.Length == 0) return null;

            var parts = body.Split(',');
            var parsed = new float[parts.Length];
            for (int i = 0; i < parts.Length; i++)
            {
                if (!float.TryParse(parts[i].Trim(), System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out parsed[i])) return null;
            }
            return parsed;
        }

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
                // A \`VECTOR(n)\` column is transmitted as a JSON array over TDS, which no
                // converter bridges to the \`float[]\` the entity declares.
                if (wanted == typeof(float[]))
                {
                    var vector = DecodeVectorColumn(value);
                    if (vector != null)
                    {
                        prop.SetValue(target, vector);
                        return;
                    }
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

    /// <summary>
    /// Read-only client for a database view.
    ///
    /// It exposes the same read methods as <see cref="TableClient{T}"/> and no
    /// write methods, so attempting to write a view fails at compile time rather
    /// than in the database. The view's rows still map onto the generated entity
    /// class, which is why the queries delegate instead of being duplicated.
    /// </summary>
    public class ViewClient<T> where T : new()
    {
        private readonly TableClient<T> _table;

        public ViewClient(string connectionString, string viewName)
        {
            _table = new TableClient<T>(connectionString, viewName);
        }

        public string ConnectionString => _table.ConnectionString;
        public string ViewName => _table.TableName;
        public An5Dialect Dialect => _table.Dialect;

        public List<T> QueryRaw(string query, Dictionary<string, object> parameters = null)
            => _table.QueryRaw(query, parameters);

        public List<T> FindMany(string whereClause = null, Dictionary<string, object> parameters = null)
            => _table.FindMany(whereClause, parameters);

        public List<T> FindMany(object args)
            => _table.FindMany(args);

        public T FindFirst(string whereClause = null, Dictionary<string, object> parameters = null)
            => _table.FindFirst(whereClause, parameters);

        public T FindFirst(object args)
            => _table.FindFirst(args);

        public T FindUnique(object id)
            => _table.FindUnique(id);

        public int Count(string whereClause = null, Dictionary<string, object> parameters = null)
            => _table.Count(whereClause, parameters);

        public int Count(object args)
            => _table.Count(args);

        public List<T> VectorSearch(List<double> vector, int take = 10, string whereClause = null, Dictionary<string, object> parameters = null, string vectorField = "Embedding", string distanceMetric = "cosine")
            => _table.VectorSearch(vector, take, whereClause, parameters, vectorField, distanceMetric);

        public Dictionary<string, object> Aggregate(
            string whereClause = null,
            Dictionary<string, object> parameters = null,
            bool count = false,
            List<string> sum = null,
            List<string> avg = null,
            List<string> min = null,
            List<string> max = null)
            => _table.Aggregate(whereClause, parameters, count, sum, avg, min, max);

        public List<Dictionary<string, object>> GroupBy(
            List<string> by,
            string whereClause = null,
            Dictionary<string, object> parameters = null,
            List<string> sum = null,
            List<string> avg = null,
            List<string> min = null,
            List<string> max = null,
            string havingClause = null,
            string orderByClause = null,
            int? skip = null,
            int? take = null,
            object count = null)
            => _table.GroupBy(by, whereClause, parameters, sum, avg, min, max, havingClause, orderByClause, skip, take, count);

        public List<Dictionary<string, object>> GroupBy(object args)
            => _table.GroupBy(args);
    }
}
`;

    fs.writeFileSync(path.join(this.outputDir, 'An5DbContext.cs'), content);
  }

  private getAllPropertyVariations(modelName: string): string[] {
    const variations = new Set<string>();
    variations.add(modelName);
    variations.add(this.toCamelCase(modelName));
    variations.add(modelName + 's');
    variations.add(this.toCamelCase(modelName) + 's');
    const acronyms = ['LLM', 'AI', 'MCP', 'IT', 'QC', 'HR', 'MR', 'WH', 'SSIS', 'API', 'URL', 'ID', 'JSON'];
    for (const acronym of acronyms) {
      if (modelName.startsWith(acronym)) {
        variations.add(acronym.toLowerCase() + modelName.slice(acronym.length));
        variations.add(acronym[0].toLowerCase() + acronym.slice(1) + modelName.slice(acronym.length));
        variations.add(acronym.toLowerCase() + modelName.slice(acronym.length) + 's');
      }
    }
    return Array.from(variations);
  }

  private capitalize(str: string): string {
    if (!str) return '';
    return str[0].toUpperCase() + str.slice(1);
  }

  private toCamelCase(str: string): string {
    if (!str) return '';
    return str[0].toLowerCase() + str.slice(1);
  }

  private toSnakeCase(str: string): string {
    if (!str) return '';
    return str
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .toLowerCase();
  }
}
