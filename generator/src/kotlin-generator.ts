/**
 * The Kotlin client generator.
 *
 * Emits `an5Client/kotlin` sources that depend on the Kotlin runtime in
 * `an5Adapters/kotlin` — the typed front door over the JVM adapter. Models are `data class`
 * values, so equality, copying and destructuring come from the language rather than from
 * generated code, and every read goes through the runtime's nullable accessors so a `NULL`
 * column stays `null` instead of becoming `0` or `""` and being written back on the next
 * update.
 */
import fs from 'fs';
import path from 'path';
import { Model, Field } from './types';
import { fieldKind } from './type-kinds';
import { Provider } from './field-types';

/** `DECIMAL(10,2)` → `DECIMAL`. */
function declaredBase(sqlType: string): string {
  return sqlType.replace(/\([^)]*\)/g, ' ').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Acronyms that must keep their capitals when a name becomes camelCase. */
const ACRONYMS = ['LLM', 'AI', 'MCP', 'IT', 'QC', 'HR', 'MR', 'WH', 'SSIS', 'API', 'URL', 'ID', 'JSON'];

/** Kotlin's hard keywords, which cannot be used as identifiers. */
const KOTLIN_KEYWORDS = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in',
  'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw',
  'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while',
]);

/** Members of `Any` and the stdlib that a field named after them would shadow. */
const KOTLIN_SHADOWED = new Set([
  'Any', 'Nothing', 'Unit', 'String', 'Int', 'Long', 'Short', 'Byte', 'Double', 'Float',
  'Boolean', 'Char', 'List', 'Map', 'Set', 'Array', 'Pair', 'Triple', 'Sequence', 'Result',
  'Companion', 'Enum', 'Throwable', 'Number',
]);

export class KotlinGenerator {
  /** The database being generated for; decides types like `TIMESTAMP`. */
  private provider: Provider | undefined;

  constructor(private outputDir: string) {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  public generate(models: Model[]): void {
    this.provider = models[0]?.provider;

    this.generateModels(models);
    this.generateOrmTypes(models);
    this.generateMetadata(models);
    this.generateConfig();
    this.generateClient(models);
  }

  // ─── Naming ─────────────────────────────────────────────────────────────────────

  private capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  /**
   * The property name for a column.
   *
   * Backticked rather than renamed where possible, so `when` stays `when`: renaming would
   * change the name in the generated data class but not in the SQL, and the mismatch is
   * harder to notice than a backtick.
   */
  private property(name: string): string {
    const camel = KotlinGenerator.toCamelCase(name);
    return KOTLIN_KEYWORDS.has(camel) || KOTLIN_SHADOWED.has(camel) ? `\`${camel}\`` : camel;
  }

  private static toCamelCase(value: string): string {
    if (!value) return value;
    const spaced = ACRONYMS.reduce(
      (text, acronym) => text.replace(new RegExp(`\\b${acronym}\\b`, 'g'), ` ${acronym} `),
      value
    );
    const words = spaced.split(/[\s_\-.]+/).filter(Boolean);
    if (words.length === 0) return value;
    const [first, ...rest] = words;
    return (
      first.charAt(0).toLowerCase() +
      first.slice(1) +
      rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
    );
  }

  private static toLowerCamelCase(value: string): string {
    return KotlinGenerator.toCamelCase(value);
  }

  // ─── Types ───────────────────────────────────────────────────────────────────────

  /** The Kotlin type for a column. */
  private mapType(field: Field): string {
    const base = declaredBase(field.sqlType ?? field.type);
    switch (fieldKind(field, this.provider)) {
      case 'int':
        return 'Int';
      case 'bigint':
        return 'Long';
      case 'float':
        // `DECIMAL`/`NUMERIC`/`MONEY` stay exact; a floating-point column does not need to.
        return ['DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY', 'FIXED'].includes(base)
          ? 'BigDecimal'
          : 'Double';
      case 'bool':
        return 'Boolean';
      case 'date':
        if (base === 'DATETIMEOFFSET' || base === 'TIMESTAMPTZ') return 'OffsetDateTime';
        if (base === 'TIME' || base === 'TIMETZ') return 'LocalTime';
        if (base === 'DATE') return 'LocalDate';
        return 'LocalDateTime';
      case 'bytes':
        return 'ByteArray';
      case 'vector':
        return 'DoubleArray';
      case 'json':
        return 'String';
      default:
        return ['GUID', 'UUID', 'UNIQUEIDENTIFIER'].includes(base) ? 'UUID' : 'String';
    }
  }

  /** The nullable form, which is what every generated property is: a column may be `NULL` until written. */
  private mapNullableType(field: Field): string {
    const mapped = this.mapType(field);
    return mapped.endsWith('?') ? mapped : `${mapped}?`;
  }

  /** The runtime accessor that reads a column into its type. */
  private readAccessor(field: Field): string {
    const base = declaredBase(field.sqlType ?? field.type);
    switch (fieldKind(field, this.provider)) {
      case 'int':
        return 'intOrNull';
      case 'bigint':
        return 'longOrNull';
      case 'float':
        return ['DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY', 'FIXED'].includes(base)
          ? 'decimalOrNull'
          : 'doubleOrNull';
      case 'bool':
        return 'boolOrNull';
      case 'date':
        if (base === 'DATETIMEOFFSET' || base === 'TIMESTAMPTZ') return 'stringOrNull';
        if (base === 'TIME' || base === 'TIMETZ') return 'localDateTimeOrNull';
        if (base === 'DATE') return 'localDateOrNull';
        return 'localDateTimeOrNull';
      case 'bytes':
        return 'bytesOrNull';
      case 'vector':
        return 'vectorOrNull';
      default:
        return ['GUID', 'UUID', 'UNIQUEIDENTIFIER'].includes(base) ? 'uuidOrNull' : 'stringOrNull';
    }
  }

  private filterType(field: Field): string {
    switch (fieldKind(field, this.provider)) {
      case 'date':
        return 'DateFilter';
      case 'bool':
        return 'BoolFilter';
      case 'int':
      case 'bigint':
      case 'float':
        return 'NumberFilter';
      default:
        return 'StringFilter';
    }
  }

  // ─── Models ──────────────────────────────────────────────────────────────────────

  private generateModels(models: Model[]): void {
    for (const model of models) {
      fs.writeFileSync(path.join(this.outputDir, `${model.name}.kt`), this.modelSource(model));
    }
  }

  private modelSource(model: Model): string {
    const name = model.name;
    let content = `// This file is auto-generated. Do not edit directly.
@file:Suppress("RedundantVisibilityModifier", "unused")

package an5.client

${[
  ...new Set(
    model.fields
      .map((field) => this.mapType(field))
      .flatMap((type) => {
        if (type === 'BigDecimal') return ['java.math.BigDecimal'];
        if (type === 'UUID') return ['java.util.UUID'];
        if (['LocalDateTime', 'LocalDate', 'LocalTime', 'OffsetDateTime'].includes(type)) {
          return [`java.time.${type}`];
        }
        return [];
      })
  ),
  'an5.adapters.Data as Values',
  'an5.adapters.Row',
  ...new Set(model.fields.map((field) => `an5.adapters.${this.readAccessor(field)}`)),
  ...(model.relations.some((rel) => rel.isArray) ? ['an5.adapters.related'] : []),
  ...(model.relations.some((rel) => !rel.isArray) ? ['an5.adapters.relatedOne'] : []),
]
  .map((entry) => `import ${entry}`)
  .join('\n')}

/**
 * ${model.description ? escapeDoc(model.description) : `The \`$name\` model.`}
 *
 * Every property is nullable and defaults to \`null\`, because \`update\` and \`upsert\` take a
 * partly filled value and a property left alone has to stay out of the statement.
 */
data class ${name}(
`;

    const properties = [
      ...model.relations.map((rel) => ({ name: rel.name, type: rel.isArray ? `List<${rel.type}>` : `${rel.type}?` })),
      ...model.fields.map((field) => ({ name: field.name, type: this.mapNullableType(field) })),
    ];

    if (properties.length === 0) {
      content += `) {\n`;
    } else {
      content += properties
        .map(
          (entry, index) =>
            `    val ${this.property(entry.name)}: ${entry.type} = ${this.defaultFor(entry.type)}${
              index === properties.length - 1 ? '' : ','
            }`
        )
        .join('\n');
      content += `\n) {\n`;
    }

    content += `
    /**
     * The columns to write, in declaration order, with \`null\` left out.
     *
     * An unset column takes the schema's DEFAULT, which is what leaving it out means.
     */
    fun toValues(): Values = buildValues {
`;

    for (const field of model.fields) {
      content += `        this["${field.name}"] = this@${name}.${this.property(field.name)}\n`;
    }
    content += `    }

    companion object {
        /**
         * Reads a ${name} out of a database row.
         *
         * Eager-loaded relations arrive as nested rows and are converted the same way; one
         * that was not asked for stays at its default, so an empty \`orders\` does not say
         * whether the query included it.
         */
        fun fromRow(row: Row): ${name} = ${name}(
`;

    for (const field of model.fields) {
      const accessor = this.readAccessor(field);
      content += `            ${this.property(field.name)} = row.${accessor}("${field.name}"),\n`;
    }
    for (const rel of model.relations) {
      const property = this.property(rel.name);
      if (rel.isArray) {
        content += `            ${property} = row.related("${rel.name}").map { ${rel.type}.fromRow(it) },\n`;
      } else {
        content += `            ${property} = row.relatedOne("${rel.name}")?.let { ${rel.type}.fromRow(it) },\n`;
      }
    }
    content += `        )
    }
}

/** Collects column values, skipping the ones left unset. */
private inline fun buildValues(block: MutableMap<String, Any?>.() -> Unit): Values {
    val values = LinkedHashMap<String, Any?>()
    values.block()
    values.entries.removeAll { it.value == null }
    return values
}
`;
    return content;
  }

  private defaultFor(type: string): string {
    if (type.startsWith('List<')) return 'emptyList()';
    if (type.endsWith('DoubleArray')) return 'DoubleArray(0)';
    if (type.endsWith('ByteArray')) return 'ByteArray(0)';
    return 'null';
  }

  // ─── ORM types ───────────────────────────────────────────────────────────────────

  private generateOrmTypes(models: Model[]): void {
    let content = `// This file is auto-generated. Do not edit directly.
@file:Suppress("unused")

package an5.client

import an5.adapters.QueryBuilder
import an5.adapters.Where
import an5.adapters.andOf
import an5.adapters.notOf
import an5.adapters.orOf

/**
 * Typed filters for the generated models.
 *
 * A filter is a small builder whose [build] produces the filter tree the runtime's SQL
 * builder reads, so a query is checked at the call site and still compiles down to bind
 * parameters rather than interpolated SQL.
 */
object An5Orm {

    /** A filter on a string column. */
    data class StringFilter(
        val equals: String? = null,
        val not: String? = null,
        val \`in\`: List<String>? = null,
        val notIn: List<String>? = null,
        val contains: String? = null,
        val startsWith: String? = null,
        val endsWith: String? = null,
    ) {
        /** The filter as the runtime reads it, with every unset operator left out. */
        fun build(): Where = operatorMap {
            equals?.let { put("equals", it) }
            not?.let { put("not", it) }
            \`in\`?.let { put("in", it) }
            notIn?.let { put("notIn", it) }
            contains?.let { put("contains", it) }
            startsWith?.let { put("startsWith", it) }
            endsWith?.let { put("endsWith", it) }
        }

        companion object {
            /** The column equals [value]. */
            fun \`is\`(value: String) = StringFilter(equals = value)

            /** The column differs from [value]. */
            fun isNot(value: String) = StringFilter(not = value)

            /** The column contains [value]. */
            fun has(value: String) = StringFilter(contains = value)
        }
    }

    /** A filter on an integer, long or floating-point column. */
    data class NumberFilter(
        val equals: Number? = null,
        val not: Number? = null,
        val \`in\`: List<Number>? = null,
        val notIn: List<Number>? = null,
        val gt: Number? = null,
        val gte: Number? = null,
        val lt: Number? = null,
        val lte: Number? = null,
    ) {
        fun build(): Where = operatorMap {
            equals?.let { put("equals", it) }
            not?.let { put("not", it) }
            \`in\`?.let { put("in", it) }
            notIn?.let { put("notIn", it) }
            gt?.let { put("gt", it) }
            gte?.let { put("gte", it) }
            lt?.let { put("lt", it) }
            lte?.let { put("lte", it) }
        }

        companion object {
            fun \`is\`(value: Number) = NumberFilter(equals = value)
            fun isNot(value: Number) = NumberFilter(not = value)
            fun atLeast(value: Number) = NumberFilter(gte = value)
            fun atMost(value: Number) = NumberFilter(lte = value)
        }
    }

    /** A filter on a boolean column. */
    data class BoolFilter(val equals: Boolean? = null, val not: Boolean? = null) {
        fun build(): Where = operatorMap {
            equals?.let { put("equals", it) }
            not?.let { put("not", it) }
        }

        companion object {
            fun \`is\`(value: Boolean) = BoolFilter(equals = value)
        }
    }

    /** A filter on a date or time column. */
    data class DateFilter(
        val equals: Any? = null,
        val not: Any? = null,
        val \`in\`: List<Any>? = null,
        val notIn: List<Any>? = null,
        val gt: Any? = null,
        val gte: Any? = null,
        val lt: Any? = null,
        val lte: Any? = null,
    ) {
        fun build(): Where = operatorMap {
            equals?.let { put("equals", it) }
            not?.let { put("not", it) }
            \`in\`?.let { put("in", it) }
            notIn?.let { put("notIn", it) }
            gt?.let { put("gt", it) }
            gte?.let { put("gte", it) }
            lt?.let { put("lt", it) }
            lte?.let { put("lte", it) }
        }

        companion object {
            fun \`is\`(value: Any) = DateFilter(equals = value)
            fun atLeast(value: Any) = DateFilter(gte = value)
            fun atMost(value: Any) = DateFilter(lte = value)
        }
    }

    private fun operatorMap(block: MutableMap<String, Any?>.() -> Unit): Where {
        val map = LinkedHashMap<String, Any?>()
        map.block()
        return map
    }
`;

    for (const model of models) {
      const name = model.name;
      content += `
    /** A \`WHERE\` for ${name}. Unset filters are left out. */
    data class ${name}Where(
        val and: List<${name}Where>? = null,
        val or: List<${name}Where>? = null,
        val not: List<${name}Where>? = null,
${model.fields.map((field) => `        val ${this.property(field.name)}: ${this.filterType(field)}? = null,`).join('\n')}
    ) {
        /** The filter tree as the runtime reads it. */
        fun build(): Where = operatorMap {
            and?.let { put("AND", it.map { clause -> clause.build() }) }
            or?.let { put("OR", it.map { clause -> clause.build() }) }
            not?.let { put("NOT", it.map { clause -> clause.build() }) }
${model.fields.map((field) => `            ${this.property(field.name)}?.let { put("${field.name}", it.build()) }`).join('\n')}
        }

        companion object {
            /** All of [clauses]; an empty list matches everything. */
            fun andOf(vararg clauses: ${name}Where) = ${name}Where(and = clauses.toList())

            /** Any of [clauses]; an empty list matches nothing. */
            fun orOf(vararg clauses: ${name}Where) = ${name}Where(or = clauses.toList())

            /** None of [clauses]; an empty list matches everything. */
            fun notOf(vararg clauses: ${name}Where) = ${name}Where(not = clauses.toList())
        }
    }

    /** An \`ORDER BY\` for ${name}. */
    data class ${name}OrderBy(val entries: List<Map<String, String>> = emptyList()) {
        fun asc(vararg columns: String) = append(columns, "asc")
        fun desc(vararg columns: String) = append(columns, "desc")

        private fun append(columns: Array<out String>, direction: String) =
            ${name}OrderBy(entries + columns.map { mapOf(it to direction) })

        /** The sort as the runtime reads it. */
        fun build(): List<Map<String, String>> = entries
    }
`;
    }

    content += `}\n`;
    fs.writeFileSync(path.join(this.outputDir, 'An5OrmTypes.kt'), content);
  }

  // ─── Metadata ────────────────────────────────────────────────────────────────────

  private generateMetadata(models: Model[]): void {
    let content = `// This file is auto-generated. Do not edit directly.
package an5.client

import an5.adapters.base.Metadata

/**
 * The generated models' tables, columns and relations.
 *
 * Registered with the runtime when a client is constructed. Without it the table clients have
 * no table names to work with and no primary key to fill in.
 */
object An5Metadata {

    /** Model name to table name, schema-qualified. */
    val modelToTable: Map<String, String> = linkedMapOf(
${models.map((model) => `        "${model.name}" to "${this.tableName(model)}",`).join('\n')}
    )

    /** Model name to its columns, as the runtime reads them. */
    val modelFields: Map<String, List<Map<String, Any?>>> = linkedMapOf(
${models
  .map(
    (model) => `        "${model.name}" to listOf(
${model.fields
  .map(
    (field) =>
      `            field("${field.name}", "${field.type}", "${field.sqlType}", ${field.isOptional}, ${field.hasDefault}, ${field.isId}${field.description ? `, ${kotlinString(field.description)}` : ''})`
  )
  .join(',\n')}
        ),`
  )
  .join('\n')}
    )

    /** Model name to its relations, keyed by relation name. */
    val relationMap: Map<String, Map<String, Map<String, String>>> = linkedMapOf(
${models
  .filter((model) => model.relations.length > 0)
  .map(
    (model) => `        "${model.name}" to linkedMapOf(
${model.relations
  .map(
    (rel) =>
      `            "${rel.name}" to relation("${rel.type}", "${rel.relationName}", "${rel.foreignKey}", "${rel.localKey}")`
  )
  .join(',\n')}
        ),`
  )
  .join('\n')}
    )

    /** Registers this schema with the runtime. */
    fun register() {
        Metadata.setAdapterMetadata(
            linkedMapOf<String, Any?>(
                "modelToTable" to modelToTable,
                "modelFields" to modelFields,
                "relationMap" to relationMap,
            )
        )
    }

    private fun field(
        name: String,
        type: String,
        sql: String,
        optional: Boolean,
        hasDefault: Boolean,
        isId: Boolean,
        description: String? = null,
    ): Map<String, Any?> = linkedMapOf(
        "name" to name,
        "type" to type,
        "sql" to sql,
        "isOptional" to optional,
        "hasDefault" to hasDefault,
        "isId" to isId,
        "description" to description,
    )

    private fun relation(
        modelName: String,
        relationType: String,
        foreignKey: String,
        localKey: String,
    ): Map<String, String> = linkedMapOf(
        "modelName" to modelName,
        "relationType" to relationType,
        "foreignKey" to foreignKey,
        "localKey" to localKey,
    )
}
`;
    fs.writeFileSync(path.join(this.outputDir, 'An5Metadata.kt'), content);
  }

  // ─── Config ──────────────────────────────────────────────────────────────────────

  private generateConfig(): void {
    const content = `// This file is auto-generated. Do not edit directly.
package an5.client

/**
 * Where the connection string comes from.
 *
 * \`DATABASE_URL\` first, then the \`an5.connectionString\` system property, so one deployment
 * can override a checked-in default without the file changing.
 */
object An5Config {

    /** The connection string, or a message naming both places it can come from. */
    fun connectionString(): String {
        System.getenv("DATABASE_URL")?.takeIf { it.isNotBlank() }?.let { return it.trim() }
        System.getProperty("an5.connectionString")?.takeIf { it.isNotBlank() }?.let { return it.trim() }
        throw IllegalStateException(
            "No connection string: set DATABASE_URL or the an5.connectionString system property."
        )
    }
}
`;
    fs.writeFileSync(path.join(this.outputDir, 'An5Config.kt'), content);
  }

  // ─── Client ──────────────────────────────────────────────────────────────────────

  private generateClient(models: Model[]): void {
    let content = `// This file is auto-generated. Do not edit directly.
package an5.client

import an5.adapters.AggregateBuilder
import an5.adapters.An5
import an5.adapters.Data
import an5.adapters.DistanceMetric
import an5.adapters.QueryBuilder
import an5.adapters.Row
import an5.adapters.TableClient
import an5.adapters.Where
import an5.adapters.andOf
import an5.adapters.contains
import an5.adapters.eq
import an5.adapters.endsWith
import an5.adapters.gte
import an5.adapters.gt
import an5.adapters.lte
import an5.adapters.lt
import an5.adapters.notOf
import an5.adapters.orOf
import an5.adapters.startsWith

/**
 * A typed client for one model.
 *
 * The runtime's [TableClient] works on untyped rows so it stays independent of the schema;
 * this adds the model's own types on top, which is what makes \`db.user.findMany {}\` come
 * back as \`List<User>\`.
 */
class ModelClient<T : Any>(
    private val delegate: TableClient,
    private val read: (Row) -> T,
    private val write: (T) -> Data,
) {

    /** The model this client reads and writes. */
    val model: String get() = delegate.model

    fun findMany(): List<T> = delegate.findMany().map(read)

    fun findMany(block: QueryBuilder.() -> Unit): List<T> = delegate.findMany(block).map(read)

    fun findMany(filter: Where): List<T> = delegate.findMany(filter).map(read)

    fun findFirst(block: QueryBuilder.() -> Unit = {}): T? = delegate.findFirst(block)?.let(read)

    fun findFirst(filter: Where): T? = delegate.findFirst(filter)?.let(read)

    fun findUnique(filter: Where): T? = delegate.findUnique(filter)?.let(read)

    fun count(filter: Where? = null): Long = delegate.count(filter)

    /** Inserts a value and returns it as stored. */
    fun create(value: T): T = delegate.create(write(value)).let(read)

    /** Inserts many values, one statement each. */
    fun createMany(values: List<T>, skipDuplicates: Boolean = false): Int =
        delegate.createMany(values.map(write), skipDuplicates)

    /** Updates the matching rows and returns the first of them re-read. */
    fun update(filter: Where, value: T): T? = delegate.update(filter, write(value))?.let(read)

    /** Updates every matching row and gives back how many changed. */
    fun updateMany(filter: Where?, value: T): Int = delegate.updateMany(filter, write(value))

    /** Deletes the matching rows and returns the one that was there first. */
    fun delete(filter: Where): T? = delegate.delete(filter)?.let(read)

    /** Deletes every matching row, or the whole table when [filter] is \`null\`. */
    fun deleteMany(filter: Where? = null): Int = delegate.deleteMany(filter)

    /** Updates the matching row when it exists, creates it otherwise. */
    fun upsert(filter: Where, create: T, update: T): T =
        delegate.upsert(filter, write(create), write(update)).let(read)

    /** One row of aggregate values, keyed \`_count\`, \`_sum_<field>\` and so on. */
    fun aggregate(block: AggregateBuilder.() -> Unit): Row = delegate.aggregate(block)

    /** One row per group, each carrying the group's count and aggregates. */
    fun groupBy(vararg by: String, block: AggregateBuilder.() -> Unit = {}): List<Row> =
        delegate.groupBy(*by, block = block)

    /** The rows nearest [vector]. */
    fun vectorSearch(
        vector: DoubleArray,
        take: Int = 10,
        filter: Where? = null,
        vectorField: String = "embedding",
        metric: DistanceMetric = DistanceMetric.COSINE,
    ): List<T> = delegate.vectorSearch(vector, take, filter, vectorField, metric).map(read)
}

/**
 * The AN5 entry point: one typed client per model, over one connection.
 *
 * \`\`\`
 * An5Db(An5Config.connectionString()).use { db ->
 *     val ada = db.user.findUnique(mapOf("name" to "Ada"))
 * }
 * \`\`\`
 *
 * Not thread-safe, exactly like the runtime underneath: a transaction holds one open
 * connection that every statement in the block has to share.
 */
class An5Db internal constructor(private val an5: An5) : AutoCloseable {

    /** Opens a client, registering this schema with the runtime. */
    constructor(connectionString: String) : this(open(connectionString))

`;

    const seen = new Set<string>();
    for (const model of models) {
      const property = KotlinGenerator.toLowerCamelCase(model.name);
      if (seen.has(property)) continue;
      seen.add(property);
      content += `    /** Queries for \`${model.name}\`. */
`;
      content += `    val ${property}: ModelClient<${model.name}> =
`;
      content += `        ModelClient(an5.table("${model.name}"), ${model.name}::fromRow, ${model.name}::toValues)

`;
    }

    content += `    /** The dialect the connection string points at. */
    val dialect get() = an5.dialect

    /** A read-only client for a database view. */
    fun view(name: String) = an5.view(name)

    /** A typed client for a table outside this schema. */
    fun <T : Any> table(
        model: String,
        read: (Row) -> T,
        write: (T) -> Data,
    ): ModelClient<T> = ModelClient(an5.table(model), read, write)

    /** Runs a query and returns its rows keyed by column label. */
    fun query(sql: String, vararg parameters: Any?): List<Row> = an5.queryRaw(sql, *parameters)

    /** Runs a statement that returns no rows and gives back the affected row count. */
    fun execute(sql: String, vararg parameters: Any?): Int = an5.executeRaw(sql, *parameters)

    /** Runs [block] inside a transaction, committing on return and rolling back on failure. */
    fun <T> transaction(block: (An5) -> T): T = an5.transaction(block)

    /** The runtime underneath, for anything the typed clients do not cover. */
    fun adapter(): An5 = an5

    override fun close() = an5.close()

    companion object {
        private fun open(connectionString: String): An5 {
            An5Metadata.register()
            return An5(connectionString)
        }
    }
}
`;
    fs.writeFileSync(path.join(this.outputDir, 'An5Db.kt'), content);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────────

  private tableName(model: Model): string {
    return model.schemaName ? `${model.schemaName}.${model.tableName}` : model.tableName;
  }
}

/** A Kotlin string literal for a schema description. */
function kotlinString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Doc-comment text.
 *
 * A comment terminator inside a description would end this comment early and leave the
 * rest of the line as code, so it is split.
 */
function escapeDoc(value: string): string {
  return value.replace(/\*\//g, '*\\/').replace(/\r?\n/g, ' ');
}