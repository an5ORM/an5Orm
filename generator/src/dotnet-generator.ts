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

    internal interface IAn5QueryArgs { }

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

      // FindManyArgs
      content += `    /// <summary>ORM-style args for ${name}.FindMany().</summary>\n`;
      content += `    public class ${name}FindManyArgs : IAn5QueryArgs\n    {\n`;
      content += `        public ${name}WhereInput Where { get; set; }\n`;
      content += `        public ${name}OrderByInput OrderBy { get; set; }\n`;
      content += `        public int? Take { get; set; }\n`;
      content += `        public int? Skip { get; set; }\n`;
      content += `        public List<string> Select { get; set; }\n`;
      content += `    }\n\n`;

      // FindFirstArgs
      content += `    /// <summary>ORM-style args for ${name}.FindFirst().</summary>\n`;
      content += `    public class ${name}FindFirstArgs : IAn5QueryArgs\n    {\n`;
      content += `        public ${name}WhereInput Where { get; set; }\n`;
      content += `        public ${name}OrderByInput OrderBy { get; set; }\n`;
      content += `        public List<string> Select { get; set; }\n`;
      content += `    }\n\n`;

      // FindUniqueArgs
      content += `    /// <summary>ORM-style args for ${name}.FindUnique().</summary>\n`;
      content += `    public class ${name}FindUniqueArgs : IAn5QueryArgs\n    {\n`;
      content += `        public ${name}WhereInput Where { get; set; }\n`;
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

        public static bool ResolveRelation(string modelName, string relKey, out An5RelationDef relation)
        {
            relation = null;
            if (string.IsNullOrEmpty(modelName) || string.IsNullOrEmpty(relKey)) return false;
            if (!RelationMap.TryGetValue(modelName, out var rels) || rels.Count == 0) return false;
            if (rels.TryGetValue(relKey, out relation)) return true;
            var snake = ToSnakeCase(relKey);
            foreach (var kv in rels)
            {
                if (string.Equals(ToSnakeCase(kv.Key), snake, StringComparison.OrdinalIgnoreCase))
                {
                    relation = kv.Value;
                    return true;
                }
            }
            return false;
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

    internal static class An5WhereBuilder
    {
        private static readonly HashSet<string> ScalarOperators = new HashSet<string>(StringComparer.Ordinal)
        { "equals", "in", "notIn", "contains", "startsWith", "endsWith", "not", "gte", "lte", "gt", "lt", "mode" };

        private static readonly HashSet<string> RelationOperators = new HashSet<string>(StringComparer.Ordinal)
        { "some", "none", "every", "is", "isNot", "is_not" };

        private static string SanitizeAlias(string s)
        {
            var sb = new System.Text.StringBuilder((s ?? "").Length);
            foreach (var ch in (s ?? ""))
                sb.Append(char.IsLetterOrDigit(ch) || ch == '_' ? ch : '_');
            var res = sb.ToString();
            return res.Length > 0 && char.IsLetter(res[0]) ? res : "rel_" + res;
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
            whereSql = "";
            orderBySql = "";
            take = null;
            skip = null;
            selectCols = null;
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
                whereSql = BuildWhereFromDict(rawDict, modelName, dialect, parameters, ref paramIdx, "", "", "");
                return;
            }

            var argType = args.GetType();
            var hasWhereProp = argType.GetProperty("Where", BindingFlags.Public | BindingFlags.Instance) != null;
            var hasOrderProp = argType.GetProperty("OrderBy", BindingFlags.Public | BindingFlags.Instance) != null;
            var hasTakeProp = argType.GetProperty("Take", BindingFlags.Public | BindingFlags.Instance) != null;
            var hasSkipProp = argType.GetProperty("Skip", BindingFlags.Public | BindingFlags.Instance) != null;
            var hasSelectProp = argType.GetProperty("Select", BindingFlags.Public | BindingFlags.Instance) != null;
            if (!(args is IAn5QueryArgs) && !hasWhereProp && !hasOrderProp && !hasTakeProp && !hasSkipProp && !hasSelectProp)
                throw new ArgumentException($"Unsupported query args type '{argType.Name}'.");

            var whereVal = argType.GetProperty("Where", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            if (whereVal != null)
            {
                if (whereVal is IAn5WhereInput)
                    whereSql = BuildWhereFromObject(whereVal, modelName, dialect, parameters, ref paramIdx, "", "", "");
                else if (whereVal is IDictionary<string, object> wd)
                    whereSql = BuildWhereFromDict(wd, modelName, dialect, parameters, ref paramIdx, "", "", "");
                else
                    throw new ArgumentException($"Unsupported Where payload type '{whereVal.GetType().Name}'.");
            }

            var orderByVal = argType.GetProperty("OrderBy", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            if (orderByVal != null)
            {
                var orderParts = new List<string>();
                foreach (var prop in orderByVal.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    var dirObj = prop.GetValue(orderByVal);
                    if (dirObj == null) continue;
                    var dirStr = dirObj.ToString()?.ToUpperInvariant() == "DESC" ? "DESC" : "ASC";
                    var col = An5Provider.Quote(An5ClientMetadata.ResolveColumn(modelName, prop.Name), dialect);
                    orderParts.Add($"{col} {dirStr}");
                }
                if (orderParts.Count > 0)
                    orderBySql = "ORDER BY " + string.Join(", ", orderParts);
            }

            var takeVal = argType.GetProperty("Take", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            if (takeVal != null) take = Convert.ToInt32(takeVal);

            var skipVal = argType.GetProperty("Skip", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            if (skipVal != null) skip = Convert.ToInt32(skipVal);

            var selectVal = argType.GetProperty("Select", BindingFlags.Public | BindingFlags.Instance)?.GetValue(args);
            if (selectVal is IEnumerable<string> selList)
            {
                selectCols = new List<string>();
                foreach (var col in selList)
                    if (!string.IsNullOrEmpty(col))
                        selectCols.Add(An5ClientMetadata.ResolveColumn(modelName, col));
            }
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
            return string.Join(" AND ", parts);
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
            AppendInFilter(parts, col, "IN", "1=0", f.In, parameters, ref paramIdx);
            AppendInFilter(parts, col, "NOT IN", "1=1", f.NotIn, parameters, ref paramIdx);
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

        private static void AppendInFilter<TVal>(List<string> parts, string col, string opSql, string emptySql, List<TVal> items, Dictionary<string, object> parameters, ref int paramIdx)
        {
            if (items == null) return;
            if (items.Count == 0)
            {
                parts.Add(emptySql);
                return;
            }
            var phs = new List<string>(items.Count);
            foreach (var item in items)
                phs.Add(AddParam(parameters, ref paramIdx, item));
            parts.Add($"{col} {opSql} ({string.Join(", ", phs)})");
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
                    if (value == null) throw new ArgumentException($"'{key}' filter payload must not be null.");
                    System.Collections.IList list;
                    if (value is IDictionary<string, object> singleMap) list = new object[] { singleMap };
                    else if (value is System.Collections.IList seq) list = seq;
                    else throw new ArgumentException($"'{key}' filter must be a dictionary or list of dictionaries.");

                    var subs = new List<string>();
                    int idx = 0;
                    foreach (var item in list)
                    {
                        if (!(item is IDictionary<string, object> subMap))
                            throw new ArgumentException($"'{key}' filter entry must be a dictionary.");
                        var s = BuildWhereFromDict(subMap, modelName, dialect, parameters, ref paramIdx, $"{prefix}{key}{idx++}_", selfRef, colPrefix);
                        subs.Add(string.IsNullOrEmpty(s) ? "1=1" : s);
                    }
                    if (subs.Count == 0)
                    {
                        if (key == "OR") parts.Add("1=0");
                    }
                    else
                    {
                        var joiner = key == "AND" ? " AND " : " OR ";
                        var negation = key == "NOT" ? "NOT " : "";
                        parts.Add(negation + "(" + string.Join(joiner, subs) + ")");
                    }
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

        private static List<string> BuildDictFieldConditions(string col, string key, object value, Dictionary<string, object> parameters, ref int paramIdx)
        {
            if (value == null) return new List<string> { $"{col} IS NULL" };
            if (!(value is IDictionary<string, object> opMap))
                return new List<string> { $"{col} = {AddParam(parameters, ref paramIdx, value)}" };

            var insensitive = false;
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
                            var nc = BuildDictFieldConditions(col, key, nested, parameters, ref paramIdx);
                            if (nc.Count > 0) outList.Add("NOT (" + string.Join(" AND ", nc) + ")");
                        }
                        else
                        {
                            var p = AddParam(parameters, ref paramIdx, val);
                            outList.Add(insensitive && val is string ? $"LOWER({col}) <> LOWER({p})" : $"{col} <> {p}");
                        }
                        break;
                    case "equals":
                        if (val == null) outList.Add($"{col} IS NULL");
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
                    case "gt": outList.Add($"{col} > {AddParam(parameters, ref paramIdx, val)}"); break;
                    case "gte": outList.Add($"{col} >= {AddParam(parameters, ref paramIdx, val)}"); break;
                    case "lt": outList.Add($"{col} < {AddParam(parameters, ref paramIdx, val)}"); break;
                    case "lte": outList.Add($"{col} <= {AddParam(parameters, ref paramIdx, val)}"); break;
                    case "in":
                    case "notIn":
                    {
                        if (val == null || val is string || val is System.Collections.IDictionary || !(val is System.Collections.IEnumerable seq))
                            throw new ArgumentException($"'{op}' on '{key}' requires a collection.");
                        var phs = new List<string>();
                        foreach (var item in seq) phs.Add(AddParam(parameters, ref paramIdx, item));
                        if (phs.Count > 0)
                            outList.Add(op == "in" ? $"{col} IN ({string.Join(", ", phs)})" : $"{col} NOT IN ({string.Join(", ", phs)})");
                        else
                            outList.Add(op == "in" ? "1=0" : "1=1");
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

    public class TableClient<T> where T : new()
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

        public List<T> FindMany(object args)
        {
            if (args == null) return FindMany(null, null);
            if (args is string sqlWhere) return FindMany(sqlWhere, null);

            An5WhereBuilder.ParseArgs(args, ModelName, Dialect, out var whereSql, out var orderBySql, out var take, out var skip, out var selectCols, out var parameters);
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
            else
            {
                if (take.HasValue && !skip.HasValue)
                {
                    query = $"SELECT TOP ({take.Value}) {cols} FROM {quotedTable}";
                    if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
                    if (!string.IsNullOrEmpty(orderBySql)) query += $" {orderBySql}";
                }
                else
                {
                    query = $"SELECT {cols} FROM {quotedTable}";
                    if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
                    if (skip.HasValue)
                    {
                        query += !string.IsNullOrEmpty(orderBySql) ? $" {orderBySql}" : " ORDER BY (SELECT NULL)";
                        query += $" OFFSET {skip.Value} ROWS";
                        if (take.HasValue) query += $" FETCH NEXT {take.Value} ROWS ONLY";
                    }
                    else if (!string.IsNullOrEmpty(orderBySql))
                    {
                        query += $" {orderBySql}";
                    }
                }
            }
            return QueryRaw(query, parameters);
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

            An5WhereBuilder.ParseArgs(args, ModelName, Dialect, out var whereSql, out var orderBySql, out var take, out var skip, out var selectCols, out var parameters);
            var cols = selectCols != null && selectCols.Count > 0
                ? string.Join(", ", selectCols.ConvertAll(c => An5Provider.Quote(c, Dialect)))
                : "*";
            var quotedTable = An5Provider.QuoteTable(TableName, Dialect);
            var effectiveTake = take ?? 1;
            string query;
            if (Dialect == An5Dialect.Postgres || Dialect == An5Dialect.Sqlite)
            {
                query = $"SELECT {cols} FROM {quotedTable}";
                if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
                if (!string.IsNullOrEmpty(orderBySql)) query += $" {orderBySql}";
                query += $" LIMIT {effectiveTake}";
                if (skip.HasValue) query += $" OFFSET {skip.Value}";
            }
            else if (skip.HasValue)
            {
                query = $"SELECT {cols} FROM {quotedTable}";
                if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
                query += !string.IsNullOrEmpty(orderBySql) ? $" {orderBySql}" : " ORDER BY (SELECT NULL)";
                query += $" OFFSET {skip.Value} ROWS FETCH NEXT {effectiveTake} ROWS ONLY";
            }
            else
            {
                query = $"SELECT TOP ({effectiveTake}) {cols} FROM {quotedTable}";
                if (!string.IsNullOrEmpty(whereSql)) query += $" WHERE {whereSql}";
                if (!string.IsNullOrEmpty(orderBySql)) query += $" {orderBySql}";
            }
            var rows = QueryRaw(query, parameters);
            return rows.Count > 0 ? rows[0] : default;
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
            List<string> max = null)
        {
            if (by == null || by.Count == 0) throw new ArgumentException("GroupBy requires at least one column in 'by'");
            var byCols = by.Select(c => An5Provider.Quote(c, Dialect)).ToList();
            var selectParts = new List<string>(byCols);
            selectParts.Add("COUNT(*) AS _count");
            if (sum != null) foreach (var col in sum) selectParts.Add($"SUM({An5Provider.Quote(col, Dialect)}) AS _sum_{col}");
            if (avg != null) foreach (var col in avg) selectParts.Add($"AVG({An5Provider.Quote(col, Dialect)}) AS _avg_{col}");
            if (min != null) foreach (var col in min) selectParts.Add($"MIN({An5Provider.Quote(col, Dialect)}) AS _min_{col}");
            if (max != null) foreach (var col in max) selectParts.Add($"MAX({An5Provider.Quote(col, Dialect)}) AS _max_{col}");

            var query = $"SELECT {string.Join(", ", selectParts)} FROM {TableName}";
            if (!string.IsNullOrEmpty(whereClause)) query += $" WHERE {whereClause}";
            query += $" GROUP BY {string.Join(", ", byCols)}";

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
            List<string> max = null)
            => _table.GroupBy(by, whereClause, parameters, sum, avg, min, max);
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
