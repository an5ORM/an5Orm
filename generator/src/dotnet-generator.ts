import fs from 'fs';
import path from 'path';
import { Model, Field, Relation } from './types';

export class DotnetGenerator {
  constructor(private outputDir: string) {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  public generate(models: Model[]) {
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

  private getCsFilterType(fieldType: string, isOptional: boolean): string {
    const lower = fieldType.toLowerCase();
    if (['datetime', 'datetime2', 'smalldatetime', 'date', 'datetimeoffset'].includes(lower)) return 'DateTimeFilter';
    if (['bool', 'boolean', 'bit'].includes(lower)) return 'BoolFilter';
    if (['int', 'integer', 'smallint', 'tinyint', 'number'].includes(lower)) return 'IntFilter';
    if (['bigint', 'long', 'float', 'real', 'double', 'decimal', 'numeric', 'money', 'smallmoney'].includes(lower)) return 'NumberFilter';
    return 'StringFilter';
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
      const csType = (f: { type: string; isOptional: boolean }) => this.mapType(f.type, f.isOptional);

      content += `    // ── ${name} ORM Types ──────────────────────────────────────────────────────\n\n`;

      // WhereInput
      content += `    /// <summary>Type-safe WHERE filter for ${name} queries.</summary>\n`;
      content += `    public class ${name}WhereInput\n    {\n`;
      content += `        public List<${name}WhereInput> AND { get; set; }\n`;
      content += `        public List<${name}WhereInput> OR { get; set; }\n`;
      content += `        public ${name}WhereInput NOT { get; set; }\n`;
      for (const f of model.fields) {
        const ft = this.getCsFilterType(f.type, f.isOptional);
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
          const ct = this.mapType(f.type, f.isOptional || f.hasDefault);
          content += `        public ${ct} ${this.capitalize(f.name)} { get; set; }\n`;
        }
      }
      content += `    }\n\n`;

      // UpdateInput
      content += `    /// <summary>Typed data for updating an existing ${name} record.</summary>\n`;
      content += `    public class ${name}UpdateInput\n    {\n`;
      for (const f of model.fields) {
        if (!f.isId) {
          const ut = this.mapType(f.type, true); // always nullable for update
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

  private mapType(fieldType: string, isOptional: boolean): string {
    let csType = 'string';
    const lowerType = fieldType.toLowerCase();

    if (['int', 'integer', 'smallint', 'tinyint', 'number'].includes(lowerType)) {
      csType = 'int';
    } else if (['bigint', 'long'].includes(lowerType)) {
      csType = 'long';
    } else if (['float', 'real', 'double'].includes(lowerType)) {
      csType = 'double';
    } else if (['decimal', 'numeric', 'money', 'smallmoney'].includes(lowerType)) {
      csType = 'decimal';
    } else if (['bool', 'boolean', 'bit'].includes(lowerType)) {
      csType = 'bool';
    } else if (['datetime', 'datetime2', 'smalldatetime', 'date'].includes(lowerType)) {
      csType = 'DateTime';
    } else if (lowerType === 'datetimeoffset') {
      csType = 'DateTimeOffset';
    } else if (lowerType === 'time') {
      csType = 'TimeSpan';
    } else if (['guid', 'uuid', 'uniqueidentifier'].includes(lowerType)) {
      csType = 'Guid';
    } else if (['bytes', 'binary', 'varbinary', 'image'].includes(lowerType)) {
      csType = 'byte[]';
    } else if (['xml', 'hierarchyid', 'geography', 'geometry', 'sysname', 'sql_variant', 'sqlvariant', 'rowversion', 'variant'].includes(lowerType)) {
      csType = 'string';
    } else if (fieldType.endsWith('[]')) {
      csType = 'string';
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
      const csType = this.mapType(field.type, field.isOptional);
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
using System.Reflection;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using An5Orm.Entities;

namespace An5Orm
{
    public class An5DbContext
    {
        public string ConnectionString { get; }
        
        [ThreadStatic]
        private static SqlConnection _txConn;
        [ThreadStatic]
        private static SqlTransaction _tx;

        public An5DbContext(string connectionString = null)
        {
            ConnectionString = connectionString ?? An5Config.ConnectionString;
        }

        public An5Transaction BeginTransaction()
        {
            var conn = new SqlConnection(ConnectionString);
            conn.Open();
            var tx = conn.BeginTransaction();
            _txConn = conn;
            _tx = tx;
            return new An5Transaction(conn, tx, () => {
                _txConn = null;
                _tx = null;
            });
        }
        
        public static SqlConnection GetActiveConnection(string connectionString, out bool isTx)
        {
            if (_txConn != null)
            {
                isTx = true;
                return _txConn;
            }
            isTx = false;
            var conn = new SqlConnection(connectionString);
            conn.Open();
            return conn;
        }
        
        public static SqlTransaction GetActiveTransaction() => _tx;

        // ── Tables / Repositories ──────────────────────────────────────────────
`;

    for (const model of models) {
      const name = this.capitalize(model.name);
      content += `        public TableClient<${model.name}> ${name}s => new TableClient<${model.name}>(ConnectionString, "${model.schemaName}.${model.tableName}");\n`;
      content += `        public TableClient<${model.name}> ${name} => ${name}s;\n`;
    }

    content += `    }

    public class An5Transaction : IDisposable
    {
        private readonly SqlConnection _conn;
        private readonly SqlTransaction _tx;
        private readonly Action _cleanup;
        private bool _completed;

        public An5Transaction(SqlConnection conn, SqlTransaction tx, Action cleanup)
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

        public TableClient(string connectionString, string tableName)
        {
            ConnectionString = connectionString;
            TableName = tableName;
        }

        private SqlCommand CreateCommand(SqlConnection conn, string query)
        {
            var cmd = new SqlCommand(query, conn);
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
                            cmd.Parameters.AddWithValue(kvp.Key.StartsWith("@") ? kvp.Key : "@" + kvp.Key, kvp.Value ?? DBNull.Value);
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
                                        prop.SetValue(item, val);
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
                            cmd.Parameters.AddWithValue(kvp.Key.StartsWith("@") ? kvp.Key : "@" + kvp.Key, kvp.Value ?? DBNull.Value);
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
                                        prop.SetValue(item, val);
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
            string query = $"SELECT TOP 1 * FROM {TableName}";
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
                            cmd.Parameters.AddWithValue(kvp.Key.StartsWith("@") ? kvp.Key : "@" + kvp.Key, kvp.Value ?? DBNull.Value);
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
                                        prop.SetValue(item, val);
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
            var sqlParams = new List<SqlParameter>();

            foreach (var prop in properties)
            {
                var val = prop.GetValue(entity);
                if (val != null)
                {
                    columns.Add(prop.Name);
                    values.Add("@" + prop.Name);
                    sqlParams.Add(new SqlParameter("@" + prop.Name, val));
                }
            }

            string query = $"INSERT INTO {TableName} ({string.Join(", ", columns)}) VALUES ({string.Join(", ", values)})";
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    cmd.Parameters.AddRange(sqlParams.ToArray());
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
            var sqlParams = new List<SqlParameter>();
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
                    sqlParams.Add(new SqlParameter("@" + prop.Name, val));
                }
            }

            if (idVal == null)
            {
                throw new InvalidOperationException("Cannot update entity without Id");
            }

            sqlParams.Add(new SqlParameter("@id", idVal));
            string query = $"UPDATE {TableName} SET {string.Join(", ", sets)} WHERE Id = @id";
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    cmd.Parameters.AddRange(sqlParams.ToArray());
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
                    cmd.Parameters.AddWithValue("@id", id);
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
                            cmd.Parameters.AddWithValue(kvp.Key.StartsWith("@") ? kvp.Key : "@" + kvp.Key, kvp.Value ?? DBNull.Value);
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
            var sqlParams = new List<SqlParameter>();
            int pIndex = 0;
            foreach (var kvp in updateData)
            {
                string paramName = "@u_" + pIndex++;
                sets.Add($"{kvp.Key} = {paramName}");
                sqlParams.Add(new SqlParameter(paramName, kvp.Value ?? DBNull.Value));
            }
            string query = $"UPDATE {TableName} SET {string.Join(", ", sets)}";
            if (!string.IsNullOrEmpty(whereClause)) query += $" WHERE {whereClause}";
            var conn = An5DbContext.GetActiveConnection(ConnectionString, out bool isTx);
            try
            {
                using (var cmd = CreateCommand(conn, query))
                {
                    cmd.Parameters.AddRange(sqlParams.ToArray());
                    if (parameters != null)
                    {
                        foreach (var kvp in parameters)
                            cmd.Parameters.AddWithValue(kvp.Key.StartsWith("@") ? kvp.Key : "@" + kvp.Key, kvp.Value ?? DBNull.Value);
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
                            cmd.Parameters.AddWithValue(kvp.Key.StartsWith("@") ? kvp.Key : "@" + kvp.Key, kvp.Value ?? DBNull.Value);
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
            // 1. Primary path: Native database SQL vector query execution (VECTOR_DISTANCE)
            try
            {
                var dim = vector.Count;
                var vecJson = JsonSerializer.Serialize(vector);
                var sql = $"SELECT TOP ({take}) *, VECTOR_DISTANCE('{distanceMetric}', CAST([{vectorField}] AS VECTOR({dim}, float32)), CAST(@query_vector AS VECTOR({dim}, float32))) AS distance FROM {TableName} WITH (NOLOCK)";

                var p = parameters != null ? new Dictionary<string, object>(parameters) : new Dictionary<string, object>();
                p["query_vector"] = vecJson;

                if (!string.IsNullOrWhiteSpace(whereClause))
                    sql += $" WHERE [{vectorField}] IS NOT NULL AND ({whereClause})";
                else
                    sql += $" WHERE [{vectorField}] IS NOT NULL";
                sql += " ORDER BY distance ASC";

                var nativeRows = QueryRaw(sql, p);
                if (nativeRows != null) return nativeRows;
            }
            catch
            {
                // Fallback to in-memory similarity computation if DB instance lacks native VECTOR_DISTANCE
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

        private bool HasColumn(SqlDataReader reader, string columnName)
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

    fs.writeFileSync(path.join(this.outputDir, 'An5DbContext.cs'), content);
  }

  private capitalize(str: string): string {
    if (!str) return '';
    return str[0].toUpperCase() + str.slice(1);
  }
}
