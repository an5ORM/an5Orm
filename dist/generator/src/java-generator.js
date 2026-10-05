"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JavaGenerator = void 0;
/**
 * The Java client generator.
 *
 * Emits plain `an5Client/java` sources that depend on `@an5/adapters`'s JVM runtime
 * (`an5Adapters/java`): a model class per schema model, typed filter inputs, the metadata
 * the adapter reads its tables and columns from, and a `An5DbContext` that hands out one
 * typed client per model.
 *
 * Two decisions shape the output. The model classes are mutable JavaBeans rather than
 * records, because `update` and `upsert` take a partly filled instance and a record has no
 * way to say "this column is not being changed". And every column is read through a
 * converter rather than cast, because JDBC hands an `INT` back as `Integer` on one driver
 * and `Long` on another, and a `NUMERIC` column still arrives as `BigDecimal`.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const type_kinds_1 = require("./type-kinds");
/** `DECIMAL(10,2)` → `DECIMAL`. */
function declaredBase(sqlType) {
    return sqlType.replace(/\([^)]*\)/g, ' ').trim().replace(/\s+/g, ' ').toUpperCase();
}
/** Acronyms that must keep their capitals when a name becomes camelCase. */
const ACRONYMS = ['LLM', 'AI', 'MCP', 'IT', 'QC', 'HR', 'MR', 'WH', 'SSIS', 'API', 'URL', 'ID', 'JSON'];
class JavaGenerator {
    constructor(outputDir) {
        this.outputDir = outputDir;
        if (!fs_1.default.existsSync(this.outputDir)) {
            fs_1.default.mkdirSync(this.outputDir, { recursive: true });
        }
    }
    generate(models) {
        this.provider = models[0]?.provider;
        this.generateModels(models);
        this.generateValues(models);
        this.generateOrmTypes(models);
        this.generateMetadata(models);
        this.generateConfig();
        this.generateDbContext(models);
    }
    // ─── Naming ─────────────────────────────────────────────────────────────────────
    capitalize(value) {
        if (!value)
            return value;
        return value.charAt(0).toUpperCase() + value.slice(1);
    }
    /**
     * The Java field name for a schema column.
     *
     * A field named `class`, `new` or `from` would not compile as an identifier, so those are
     * suffixed rather than left to fail at the call site.
     */
    fieldName(name) {
        const pascal = this.capitalize(name);
        return JAVA_RESERVED.has(pascal) ? `${pascal}Field` : pascal;
    }
    getterName(field) {
        const pascal = this.fieldName(field.name);
        return JAVA_RESERVED.has(pascal) ? `get${pascal}` : `get${pascal}`;
    }
    static toCamelCase(value) {
        if (!value)
            return value;
        const spaced = ACRONYMS.reduce((text, acronym) => text.replace(new RegExp(`\\b${acronym}\\b`, 'g'), ` ${acronym} `), value);
        const words = spaced.split(/[\s_\-.]+/).filter(Boolean);
        if (words.length === 0)
            return value;
        const [first, ...rest] = words;
        return (first.charAt(0).toLowerCase() +
            first.slice(1) +
            rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(''));
    }
    static toLowerCamelCase(value) {
        return JavaGenerator.toCamelCase(value);
    }
    /**
     * Every spelling of a model name the client registers it under.
     *
     * The metadata is keyed in camelCase while the model class is PascalCase, and the adapter
     * resolves the difference; these are the names the context exposes so either spelling
     * works at the call site.
     */
    propertyNames(modelName) {
        const pascal = this.capitalize(modelName);
        const camel = JavaGenerator.toLowerCamelCase(modelName);
        const snake = pascal.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
        return Array.from(new Set([camel, pascal, snake]));
    }
    // ─── Types ───────────────────────────────────────────────────────────────────────
    /**
     * The Java type for a column.
     *
     * Driven by the declared type, so a `DECIMAL` column is a `BigDecimal` and not an `int`:
     * both arrive from the parser as `number`, which is how the earlier clients turned
     * decimal money into integers.
     */
    mapType(field) {
        const base = declaredBase(field.sqlType ?? field.type);
        switch ((0, type_kinds_1.fieldKind)(field, this.provider)) {
            case 'int':
                return 'int';
            case 'bigint':
                return 'long';
            case 'float':
                // `DECIMAL`/`NUMERIC`/`MONEY` are exact; a floating-point column is not. Truncating
                // a decimal through a `double` is a rounding bug waiting to reach an invoice.
                return ['DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY', 'FIXED'].includes(base)
                    ? 'BigDecimal'
                    : 'double';
            case 'bool':
                return 'boolean';
            case 'date':
                if (base === 'DATETIMEOFFSET' || base === 'TIMESTAMPTZ')
                    return 'OffsetDateTime';
                if (base === 'TIME' || base === 'TIMETZ')
                    return 'LocalTime';
                if (base === 'DATE')
                    return 'LocalDate';
                return 'LocalDateTime';
            case 'bytes':
                return 'byte[]';
            case 'vector':
                return 'double[]';
            case 'json':
                return 'String';
            default:
                return ['GUID', 'UUID', 'UNIQUEIDENTIFIER'].includes(base) ? 'UUID' : 'String';
        }
    }
    /**
     * The boxed form used in a model.
     *
     * Every field is boxed, primitives included: `toValues` skips the columns left null, and a
     * column the schema does not mark optional can still read NULL until a row is written. A
     * primitive cannot represent "unset", so the skip would have to give the column a default
     * and quietly write it.
     */
    mapNullableType(field) {
        return box(this.mapType(field));
    }
    getFilterType(field) {
        switch ((0, type_kinds_1.fieldKind)(field, this.provider)) {
            case 'date':
                return 'DateFilter';
            case 'bool':
                return 'BoolFilter';
            case 'int':
            case 'bigint':
                return 'NumberFilter';
            case 'float':
                return 'NumberFilter';
            default:
                return 'StringFilter';
        }
    }
    // ─── Files ───────────────────────────────────────────────────────────────────────
    generateModels(models) {
        for (const model of models) {
            fs_1.default.writeFileSync(path_1.default.join(this.outputDir, `${model.name}.java`), this.modelSource(model));
        }
    }
    modelSource(model) {
        const name = model.name;
        // Only the imports this model's columns can reach: an unused import in a generated file
        // reads as something the generator forgot rather than as what it is.
        const types = new Set(model.fields.map((field) => this.mapType(field)));
        const imports = new Set();
        if (types.has('BigDecimal'))
            imports.add('java.math.BigDecimal');
        for (const type of ['LocalDateTime', 'LocalDate', 'LocalTime', 'OffsetDateTime']) {
            if (types.has(type))
                imports.add(`java.time.${type}`);
        }
        if (types.has('byte[]'))
            imports.add('java.nio.charset.StandardCharsets');
        if (model.relations.length > 0)
            imports.add('java.util.List');
        if (model.relations.some((rel) => rel.isArray))
            imports.add('java.util.ArrayList');
        imports.add('java.util.LinkedHashMap');
        imports.add('java.util.Map');
        let content = `// This file is auto-generated. Do not edit directly.
package an5.client;

${Array.from(imports)
            .sort()
            .map((entry) => `import ${entry};`)
            .join('\n')}

/**
 * ${model.description ? escapeDoc(model.description) : `The \`${name}\` model.`}
 *
 * <p>Mutable with getters and setters rather than a record, because \`update\` and \`upsert\`
 * take a partly filled instance and a record cannot say "this column is unchanged".
 */
public class ${name} {
`;
        if (model.relations.length > 0) {
            content += `\n  // ── Relations ────────────────────────────────────────────────────────────\n`;
            for (const rel of model.relations) {
                const javaType = rel.isArray ? `List<${rel.type}>` : rel.type;
                content += `  private ${javaType} ${JavaGenerator.toLowerCamelCase(rel.name)};\n`;
            }
            content += '\n';
        }
        for (const field of model.fields) {
            content += `  private ${this.mapNullableType(field)} ${JavaGenerator.toLowerCamelCase(field.name)};\n`;
        }
        content += `\n`;
        for (const field of model.fields) {
            const property = JavaGenerator.toLowerCamelCase(field.name);
            const accessor = this.fieldName(field.name);
            const type = this.mapNullableType(field);
            content += `  public ${type} ${this.getterName(field)}() {\n    return this.${property};\n  }\n\n`;
            content += `  public void set${accessor}(${type} value) {\n    this.${property} = value;\n  }\n\n`;
            content += `  /** Sets ${accessor} and returns this instance, for chained construction. */\n`;
            content += `  public ${name} with${accessor}(${type} value) {\n    this.${property} = value;\n    return this;\n  }\n\n`;
        }
        if (model.relations.length > 0) {
            for (const rel of model.relations) {
                const property = JavaGenerator.toLowerCamelCase(rel.name);
                const type = rel.isArray ? `List<${rel.type}>` : rel.type;
                const accessor = this.fieldName(rel.name);
                content += `  public ${type} ${this.getterName({ name: rel.name })}() {\n    return this.${property};\n  }\n\n`;
                content += `  public void set${accessor}(${type} value) {\n    this.${property} = value;\n  }\n\n`;
            }
        }
        content += `  /**
   * Reads \`${name}\` from a database row.
   *
   * <p>Every column goes through a converter rather than a cast: JDBC hands an \`INT\` back as
   * \`Integer\` on one driver and \`Long\` on another, and a \`NUMERIC\` column that fits in a
   * \`long\` still arrives as a \`BigDecimal\`.
   *
   * <p>Eager-loaded relations arrive as nested rows and are converted the same way. One that
   * was not asked for is left as it is, so \`getOrders()\` being \`null\` still means the query
   * did not include it.
   */
  public static ${name} fromRow(Map<String, Object> row) {
    ${name} value = new ${name}();
`;
        for (const field of model.fields) {
            const property = JavaGenerator.toLowerCamelCase(field.name);
            content += `    value.${property} = ${this.readExpression(field)};\n`;
        }
        for (const rel of model.relations) {
            const property = JavaGenerator.toLowerCamelCase(rel.name);
            if (rel.isArray) {
                content += `    if (row.get("${rel.name}") instanceof List) {
      List<${rel.type}> related = new ArrayList<${rel.type}>();
      for (Object item : (List<?>) row.get("${rel.name}")) {
        if (item instanceof Map) {
          @SuppressWarnings("unchecked")
          Map<String, Object> relationRow = (Map<String, Object>) item;
          related.add(${rel.type}.fromRow(relationRow));
        }
      }
      value.${property} = related;
    }
`;
            }
            else {
                content += `    if (row.get("${rel.name}") instanceof Map) {
      @SuppressWarnings("unchecked")
      Map<String, Object> relationRow = (Map<String, Object>) row.get("${rel.name}");
      value.${property} = ${rel.type}.fromRow(relationRow);
    }
`;
            }
        }
        content += `    return value;\n  }\n\n`;
        content += `  /**
   * The columns to write, in declaration order, with \`null\` left out.
   *
   * <p>An unset column takes the schema's DEFAULT, which is what leaving it out means — and
   * what \`update\` needs so a partial instance does not blank every other column.
   */
  public Map<String, Object> toValues() {
    Map<String, Object> values = new LinkedHashMap<String, Object>();
`;
        for (const field of model.fields) {
            const property = JavaGenerator.toLowerCamelCase(field.name);
            content += `    if (this.${property} != null) {\n      values.put("${field.name}", this.${property});\n    }\n`;
        }
        content += `    return values;\n  }\n\n`;
        content += `  @Override\n  public String toString() {\n    return "${name}" + toValues();\n  }\n}\n`;
        return content;
    }
    /** The expression that reads one column into its field. */
    readExpression(field) {
        const type = this.mapType(field);
        switch (type) {
            case 'int':
                return `An5Values.asInteger(row.get("${field.name}"))`;
            case 'long':
                return `An5Values.asLong(row.get("${field.name}"))`;
            case 'double':
                return `An5Values.asDouble(row.get("${field.name}"))`;
            case 'BigDecimal':
                return `An5Values.asBigDecimal(row.get("${field.name}"))`;
            case 'boolean':
                return `An5Values.asBoolean(row.get("${field.name}"))`;
            case 'LocalDateTime':
                return `An5Values.asLocalDateTime(row.get("${field.name}"))`;
            case 'LocalDate':
                return `An5Values.asLocalDate(row.get("${field.name}"))`;
            case 'LocalTime':
                return `An5Values.asLocalTime(row.get("${field.name}"))`;
            case 'OffsetDateTime':
                return `An5Values.asOffsetDateTime(row.get("${field.name}"))`;
            case 'byte[]':
                return `An5Values.asBytes(row.get("${field.name}"))`;
            case 'double[]':
                return `An5Values.asVector(row.get("${field.name}"))`;
            case 'UUID':
                return `An5Values.asUuid(row.get("${field.name}"))`;
            default:
                return `An5Values.asString(row.get("${field.name}"))`;
        }
    }
    // ─── An5Values ───────────────────────────────────────────────────────────────────
    generateValues(models) {
        // Only the converters this schema's columns can reach are emitted: a model with no
        // `OffsetDateTime` column should not drag one into every compilation unit.
        const used = new Set();
        for (const model of models) {
            for (const field of model.fields)
                used.add(this.mapType(field));
        }
        const needs = (type) => used.has(type);
        let content = `// This file is auto-generated. Do not edit directly.
package an5.client;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Column-value converters for JDBC drivers.
 *
 * <p>A cast is not enough. The same \`INT\` column arrives as \`Integer\`, \`Long\` or
 * \`BigDecimal\` depending on the driver and the declared width; a timestamp arrives as
 * \`java.sql.Timestamp\`, a string, or a \`Long\` of epoch milliseconds; and a vector column
 * arrives as text on all three vector stores. Each converter accepts every form, so a
 * generated model never has to know which driver is underneath it.
 */
public final class An5Values {

  private An5Values() {}

  /** The value as text, or {@code null} for a SQL \`NULL\`. */
  public static String asString(Object value) {
    if (value == null) return null;
    if (value instanceof String) return (String) value;
    if (value instanceof byte[]) return new String((byte[]) value, StandardCharsets.UTF_8);
    if (value instanceof UUID) return value.toString();
    return String.valueOf(value);
  }

  public static Integer asInteger(Object value) {
    if (value == null) return null;
    if (value instanceof Number) return ((Number) value).intValue();
    if (value instanceof Boolean) return ((Boolean) value) ? 1 : 0;
    try {
      return Integer.valueOf(String.valueOf(value).trim());
    } catch (NumberFormatException error) {
      return null;
    }
  }

  public static Long asLong(Object value) {
    if (value == null) return null;
    if (value instanceof Number) return ((Number) value).longValue();
    if (value instanceof Boolean) return ((Boolean) value) ? 1L : 0L;
    try {
      return Long.valueOf(String.valueOf(value).trim());
    } catch (NumberFormatException error) {
      return null;
    }
  }

  public static Double asDouble(Object value) {
    if (value == null) return null;
    if (value instanceof Number) return ((Number) value).doubleValue();
    if (value instanceof Boolean) return ((Boolean) value) ? 1.0 : 0.0;
    try {
      return Double.valueOf(String.valueOf(value).trim());
    } catch (NumberFormatException error) {
      return null;
    }
  }

  public static BigDecimal asBigDecimal(Object value) {
    if (value == null) return null;
    if (value instanceof BigDecimal) return (BigDecimal) value;
    if (value instanceof Double || value instanceof Float) {
      // Through the string form, not \`new BigDecimal(double)\`: that constructor takes the
      // binary expansion, so 0.1 becomes 0.1000000000000000055511151231257827.
      return BigDecimal.valueOf(((Number) value).doubleValue());
    }
    if (value instanceof Number) return BigDecimal.valueOf(((Number) value).longValue());
    try {
      return new BigDecimal(String.valueOf(value).trim());
    } catch (NumberFormatException error) {
      return null;
    }
  }

  public static Boolean asBoolean(Object value) {
    if (value == null) return null;
    if (value instanceof Boolean) return (Boolean) value;
    if (value instanceof Number) return ((Number) value).intValue() != 0;
    String text = String.valueOf(value).trim();
    if ("1".equals(text) || "true".equalsIgnoreCase(text)) return Boolean.TRUE;
    if ("0".equals(text) || "false".equalsIgnoreCase(text)) return Boolean.FALSE;
    return null;
  }
`;
        if (needs('LocalDateTime') || needs('LocalDate') || needs('LocalTime') || needs('OffsetDateTime')) {
            content += `
  public static LocalDateTime asLocalDateTime(Object value) {
    if (value == null) return null;
    if (value instanceof LocalDateTime) return (LocalDateTime) value;
    if (value instanceof Timestamp) return ((Timestamp) value).toLocalDateTime();
    if (value instanceof java.sql.Date) return ((java.sql.Date) value).toLocalDate().atStartOfDay();
    if (value instanceof OffsetDateTime) return ((OffsetDateTime) value).toLocalDateTime();
    if (value instanceof Number) {
      return LocalDateTime.ofInstant(Instant.ofEpochMilli(((Number) value).longValue()), ZoneOffset.UTC);
    }
    String text = String.valueOf(value).trim();
    try {
      return LocalDateTime.parse(text.replace(' ', 'T'));
    } catch (RuntimeException error) {
      return null;
    }
  }

  public static LocalDate asLocalDate(Object value) {
    if (value == null) return null;
    if (value instanceof LocalDate) return (LocalDate) value;
    if (value instanceof java.sql.Date) return ((java.sql.Date) value).toLocalDate();
    if (value instanceof Timestamp) return ((Timestamp) value).toLocalDateTime().toLocalDate();
    if (value instanceof LocalDateTime) return ((LocalDateTime) value).toLocalDate();
    try {
      return LocalDate.parse(String.valueOf(value).trim());
    } catch (RuntimeException error) {
      LocalDateTime parsed = asLocalDateTime(value);
      return parsed == null ? null : parsed.toLocalDate();
    }
  }

  public static LocalTime asLocalTime(Object value) {
    if (value == null) return null;
    if (value instanceof LocalTime) return (LocalTime) value;
    if (value instanceof Timestamp) return ((Timestamp) value).toLocalDateTime().toLocalTime();
    if (value instanceof java.sql.Time) return ((java.sql.Time) value).toLocalTime();
    try {
      return LocalTime.parse(String.valueOf(value).trim());
    } catch (RuntimeException error) {
      LocalDateTime parsed = asLocalDateTime(value);
      return parsed == null ? null : parsed.toLocalTime();
    }
  }

  public static OffsetDateTime asOffsetDateTime(Object value) {
    if (value == null) return null;
    if (value instanceof OffsetDateTime) return (OffsetDateTime) value;
    if (value instanceof Timestamp) return ((Timestamp) value).toInstant().atOffset(ZoneOffset.UTC);
    try {
      return OffsetDateTime.parse(String.valueOf(value).trim());
    } catch (RuntimeException error) {
      LocalDateTime parsed = asLocalDateTime(value);
      return parsed == null ? null : parsed.atOffset(ZoneOffset.UTC);
    }
  }
`;
        }
        content += `
  public static byte[] asBytes(Object value) {
    if (value == null) return null;
    if (value instanceof byte[]) return (byte[]) value;
    return String.valueOf(value).getBytes(StandardCharsets.UTF_8);
  }

  public static UUID asUuid(Object value) {
    String text = asString(value);
    if (text == null || text.isEmpty()) return null;
    try {
      return UUID.fromString(text);
    } catch (IllegalArgumentException error) {
      return null;
    }
  }

  /**
   * A stored vector as a double array.
   *
   * <p>All three vector stores hand the column back as text — SQL Server's \`VECTOR\`,
   * PostgreSQL's \`vector\`, and a JSON blob — so the same \`[0.1, 0.2]\` form is parsed here.
   */
  public static double[] asVector(Object value) {
    String text = asString(value);
    if (text == null) return null;
    int open = text.indexOf('[');
    int close = text.lastIndexOf(']');
    if (open < 0 || close <= open) return null;
    String body = text.substring(open + 1, close).trim();
    if (body.isEmpty()) return null;
    String[] parts = body.split(",");
    double[] parsed = new double[parts.length];
    for (int i = 0; i < parts.length; i++) {
      try {
        parsed[i] = Double.parseDouble(parts[i].trim());
      } catch (NumberFormatException error) {
        return null;
      }
    }
    return parsed;
  }

  /** Renders a vector the way the vector stores expect it, as \`[0.1, 0.2]\`. */
  public static String formatVector(double[] vector) {
    StringBuilder out = new StringBuilder("[");
    for (int i = 0; i < vector.length; i++) {
      if (i > 0) out.append(", ");
      out.append(vector[i]);
    }
    return out.append(']').toString();
  }

  /** The value as a list, so a filter's \`in\` list accepts a single item. */
  public static List<Object> asList(Object value) {
    List<Object> list = new ArrayList<Object>();
    if (value == null) return list;
    if (value instanceof List) {
      for (Object entry : (List<?>) value) list.add(entry);
      return list;
    }
    list.add(value);
    return list;
  }
}
`;
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, 'An5Values.java'), content);
    }
    // ─── ORM types ───────────────────────────────────────────────────────────────────
    generateOrmTypes(models) {
        let content = `// This file is auto-generated. Do not edit directly.
package an5.client;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Typed filters for the generated models.
 *
 * <p>A filter is a small object whose \`toMap()\` produces the operator map the adapter's SQL
 * builder reads, so a query is type-checked at the call site and still compiles down to
 * bind parameters rather than interpolated SQL.
 */
public final class An5OrmTypes {

  private An5OrmTypes() {}

  /** Shorthands for the operator maps, for a one-off condition. */
  public static final class Filters {
    private Filters() {}

    public static Map<String, Object> eq(Object value) {
      return operator("equals", value);
    }

    public static Map<String, Object> neq(Object value) {
      return operator("not", value);
    }

    public static Map<String, Object> gt(Object value) {
      return operator("gt", value);
    }

    public static Map<String, Object> gte(Object value) {
      return operator("gte", value);
    }

    public static Map<String, Object> lt(Object value) {
      return operator("lt", value);
    }

    public static Map<String, Object> lte(Object value) {
      return operator("lte", value);
    }

    public static Map<String, Object> contains(String value) {
      return operator("contains", value);
    }

    public static Map<String, Object> startsWith(String value) {
      return operator("startsWith", value);
    }

    public static Map<String, Object> endsWith(String value) {
      return operator("endsWith", value);
    }

    /** An empty list matches nothing. */
    public static Map<String, Object> in(Object... values) {
      return operator("in", Arrays.asList(values));
    }

    /** An empty list matches everything. */
    public static Map<String, Object> notIn(Object... values) {
      return operator("notIn", Arrays.asList(values));
    }

    /** The column is \`NULL\`. */
    public static Map<String, Object> isNull() {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      filter.put("equals", null);
      return filter;
    }

    /** The column has a value. */
    public static Map<String, Object> isNotNull() {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      filter.put("not", null);
      return filter;
    }

    /** All of \`clauses\`; an empty array matches everything. */
    @SafeVarargs
    public static Map<String, Object> and(Map<String, Object>... clauses) {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      filter.put("AND", copyOf(clauses));
      return filter;
    }

    /** Any of \`clauses\`; an empty array matches nothing. */
    @SafeVarargs
    public static Map<String, Object> or(Map<String, Object>... clauses) {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      filter.put("OR", copyOf(clauses));
      return filter;
    }

    /** None of \`clauses\`; an empty array matches everything. */
    @SafeVarargs
    public static Map<String, Object> not(Map<String, Object>... clauses) {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      filter.put("NOT", copyOf(clauses));
      return filter;
    }

    private static Map<String, Object> operator(String name, Object value) {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      filter.put(name, value);
      return filter;
    }
  }

  /** Type-safe filter for string columns. */
  public static final class StringFilter {
    public String equals;
    public String not;
    public List<String> in;
    public List<String> notIn;
    public String contains;
    public String startsWith;
    public String endsWith;
    public String gt;
    public String gte;
    public String lt;
    public String lte;

    public Map<String, Object> toMap() {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      put(filter, "equals", equals);
      put(filter, "not", not);
      put(filter, "in", in);
      put(filter, "notIn", notIn);
      put(filter, "contains", contains);
      put(filter, "startsWith", startsWith);
      put(filter, "endsWith", endsWith);
      put(filter, "gt", gt);
      put(filter, "gte", gte);
      put(filter, "lt", lt);
      put(filter, "lte", lte);
      return filter;
    }

    public static StringFilter is(String value) {
      StringFilter filter = new StringFilter();
      filter.equals = value;
      return filter;
    }

    public static StringFilter isNot(String value) {
      StringFilter filter = new StringFilter();
      filter.not = value;
      return filter;
    }

    public static StringFilter has(String substring) {
      StringFilter filter = new StringFilter();
      filter.contains = substring;
      return filter;
    }
  }

  /** Type-safe filter for integer and numeric columns. */
  public static final class NumberFilter {
    public Number equals;
    public Number not;
    public List<Number> in;
    public List<Number> notIn;
    public Number gt;
    public Number gte;
    public Number lt;
    public Number lte;

    public Map<String, Object> toMap() {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      put(filter, "equals", equals);
      put(filter, "not", not);
      put(filter, "in", in);
      put(filter, "notIn", notIn);
      put(filter, "gt", gt);
      put(filter, "gte", gte);
      put(filter, "lt", lt);
      put(filter, "lte", lte);
      return filter;
    }

    public static NumberFilter atLeast(Number value) {
      NumberFilter filter = new NumberFilter();
      filter.gte = value;
      return filter;
    }

    public static NumberFilter atMost(Number value) {
      NumberFilter filter = new NumberFilter();
      filter.lte = value;
      return filter;
    }

    public static NumberFilter is(Number value) {
      NumberFilter filter = new NumberFilter();
      filter.equals = value;
      return filter;
    }
  }

  /** Type-safe filter for boolean columns. */
  public static final class BoolFilter {
    public Boolean equals;
    public Boolean not;

    public Map<String, Object> toMap() {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      put(filter, "equals", equals);
      put(filter, "not", not);
      return filter;
    }

    public static BoolFilter is(boolean value) {
      BoolFilter filter = new BoolFilter();
      filter.equals = Boolean.valueOf(value);
      return filter;
    }
  }

  /** Type-safe filter for date and time columns. */
  public static final class DateFilter {
    public Object equals;
    public Object not;
    public List<Object> in;
    public List<Object> notIn;
    public Object gt;
    public Object gte;
    public Object lt;
    public Object lte;

    public Map<String, Object> toMap() {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      put(filter, "equals", equals);
      put(filter, "not", not);
      put(filter, "in", in);
      put(filter, "notIn", notIn);
      put(filter, "gt", gt);
      put(filter, "gte", gte);
      put(filter, "lt", lt);
      put(filter, "lte", lte);
      return filter;
    }

    public static DateFilter atLeast(Object value) {
      DateFilter filter = new DateFilter();
      filter.gte = value;
      return filter;
    }
  }

  /**
   * Copies a clause array into a list.
   *
   * <p>Element by element rather than {@code Arrays.asList(clauses)}, which wraps the caller's
   * own array: a caller that later writes into it would change a filter already handed to a
   * query, and {@code @SafeVarargs} forbids letting the array escape at all.
   */
  @SafeVarargs
  private static List<Object> copyOf(Map<String, Object>... clauses) {
    List<Object> copy = new ArrayList<Object>();
    for (Map<String, Object> clause : clauses) {
      copy.add(clause);
    }
    return copy;
  }

  private static void put(Map<String, Object> filter, String name, Object value) {
    // A field left unset must not become \`col IS NULL\`: the builder treats an explicit null
    // as "match NULL", so an unset filter has to be absent from the map entirely.
    if (value != null) filter.put(name, value);
  }
`;
        for (const model of models) {
            const name = model.name;
            content += `
  // ── ${name} ─────────────────────────────────────────────────────────────────────

  /** Type-safe \`WHERE\` for ${name}. Unset filters are left out. */
  public static final class ${name}Where {
    public List<${name}Where> and;
    public List<${name}Where> or;
    public ${name}Where not;
`;
            for (const field of model.fields) {
                content += `    public ${this.getFilterType(field)} ${this.fieldName(field.name)};\n`;
            }
            content += `
    public ${name}Where and(${name}Where... clauses) {
      this.and = Arrays.asList(clauses);
      return this;
    }

    public ${name}Where or(${name}Where... clauses) {
      this.or = Arrays.asList(clauses);
      return this;
    }

    public ${name}Where not(${name}Where clause) {
      this.not = clause;
      return this;
    }

    /** The filter as the adapter reads it, with every unset condition left out. */
    public Map<String, Object> toMap() {
      Map<String, Object> filter = new LinkedHashMap<String, Object>();
      if (and != null) filter.put("AND", toMapValues(and));
      if (or != null) filter.put("OR", toMapValues(or));
      if (not != null) filter.put("NOT", toMapValues(Arrays.asList(not)));
`;
            for (const field of model.fields) {
                const property = this.fieldName(field.name);
                content += `      if (${property} != null) filter.put("${field.name}", ${property}.toMap());\n`;
            }
            content += `      return filter;
    }

    /**
     * The filter tree as the adapter reads it.
     *
     * <p>Nested clauses have to be converted here rather than handed over as objects: the
     * SQL builder only understands maps, and an object in the list parses as an empty
     * clause, which matches every row instead of failing.
     */
    private static Object toMapValue(Object value) {
      if (value instanceof ${name}Where) return ((${name}Where) value).toMap();
      return value;
    }

    /** Converts a group of nested clauses to the map form the adapter reads. */
    private static List<Object> toMapValues(List<${name}Where> clauses) {
      List<Object> values = new ArrayList<Object>(clauses.size());
      for (${name}Where clause : clauses) values.add(toMapValue(clause));
      return values;
    }
  }

  /** Type-safe \`ORDER BY\` for ${name}. */
  public static final class ${name}OrderBy {
    private final List<Map<String, String>> entries = new ArrayList<Map<String, String>>();

    public ${name}OrderBy by(String... columns) {
      for (String column : columns) {
        entries.add(single(column, "asc"));
      }
      return this;
    }

    public ${name}OrderBy desc(String column) {
      entries.add(single(column, "desc"));
      return this;
    }

    private static Map<String, String> single(String column, String direction) {
      Map<String, String> entry = new LinkedHashMap<String, String>();
      entry.put(column, direction);
      return entry;
    }

    public List<Map<String, String>> toList() {
      return entries;
    }
  }
`;
        }
        content += `}\n`;
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, 'An5OrmTypes.java'), content);
    }
    // ─── Metadata ────────────────────────────────────────────────────────────────────
    generateMetadata(models) {
        let content = `// This file is auto-generated. Do not edit directly.
package an5.client;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import an5.adapters.base.Metadata;

/**
 * The generated models' tables, columns and relations.
 *
 * <p>Registered with the adapter when a context is constructed. Without it the table clients
 * have no table names to work with and no primary key to fill in.
 */
public final class An5Metadata {

  private An5Metadata() {}

  /** Model name to table name, schema-qualified. */
  public static final Map<String, String> MODEL_TO_TABLE;

  /** Model name to its columns, as the adapter reads them. */
  public static final Map<String, List<Map<String, Object>>> MODEL_FIELDS;

  /** Model name to its relations, keyed by relation name. */
  public static final Map<String, Map<String, Map<String, String>>> RELATION_MAP;

  static {
    Map<String, String> tables = new LinkedHashMap<String, String>();
    Map<String, List<Map<String, Object>>> fields = new LinkedHashMap<String, List<Map<String, Object>>>();
    Map<String, Map<String, Map<String, String>>> relations =
        new LinkedHashMap<String, Map<String, Map<String, String>>>();

`;
        for (const model of models) {
            content += `    tables.put("${model.name}", "${this.tableName(model)}");\n`;
            content += `    fields.put("${model.name}", Arrays.asList(\n`;
            for (const field of model.fields) {
                content += `        field("${field.name}", "${field.type}", "${field.sqlType}", ${field.isOptional}, ${field.hasDefault}, ${field.isId}${field.description ? `, ${javaString(field.description)}` : ''})${field === model.fields[model.fields.length - 1] ? '' : ','}\n`;
            }
            content += `    ));\n`;
            if (model.relations.length > 0) {
                content += `    Map<String, Map<String, String>> ${lowerFirst(model.name)}Relations =\n`;
                content += `        new LinkedHashMap<String, Map<String, String>>();\n`;
                for (const rel of model.relations) {
                    content += `    ${lowerFirst(model.name)}Relations.put("${rel.name}",\n`;
                    content += `        relation("${rel.type}", "${rel.relationName}", "${rel.foreignKey}", "${rel.localKey}"));\n`;
                }
                content += `    relations.put("${model.name}", ${lowerFirst(model.name)}Relations);\n`;
            }
        }
        content += `
    MODEL_TO_TABLE = Collections.unmodifiableMap(tables);
    MODEL_FIELDS = Collections.unmodifiableMap(fields);
    RELATION_MAP = Collections.unmodifiableMap(relations);
  }

  private static Map<String, Object> field(
      String name, String type, String sql, boolean optional, boolean hasDefault, boolean isId) {
    return field(name, type, sql, optional, hasDefault, isId, null);
  }

  private static Map<String, Object> field(
      String name,
      String type,
      String sql,
      boolean optional,
      boolean hasDefault,
      boolean isId,
      String description) {
    Map<String, Object> field = new LinkedHashMap<String, Object>();
    field.put("name", name);
    field.put("type", type);
    field.put("sql", sql);
    field.put("isOptional", Boolean.valueOf(optional));
    field.put("hasDefault", Boolean.valueOf(hasDefault));
    field.put("isId", Boolean.valueOf(isId));
    field.put("description", description);
    return field;
  }

  private static Map<String, String> relation(
      String modelName, String relationName, String foreignKey, String localKey) {
    Map<String, String> relation = new LinkedHashMap<String, String>();
    relation.put("modelName", modelName);
    relation.put("relationType", relationName);
    relation.put("foreignKey", foreignKey);
    relation.put("localKey", localKey);
    return relation;
  }

  /** Registers this schema with the adapter runtime. */
  public static void register() {
    Map<String, Object> metadata = new LinkedHashMap<String, Object>();
    metadata.put("modelToTable", MODEL_TO_TABLE);
    metadata.put("modelFields", MODEL_FIELDS);
    metadata.put("relationMap", RELATION_MAP);
    Metadata.setAdapterMetadata(metadata);
  }
}
`;
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, 'An5Metadata.java'), content);
    }
    // ─── Config ──────────────────────────────────────────────────────────────────────
    generateConfig() {
        const content = `// This file is auto-generated. Do not edit directly.
package an5.client;

/**
 * Where the connection string comes from.
 *
 * <p>\`DATABASE_URL\` first, then the system property, so one deployment can override a
 * checked-in default without the file changing.
 */
public final class An5Config {

  private An5Config() {}

  /** The connection string, from the environment or the \`an5.connectionString\` property. */
  public static String connectionString() {
    String fromEnvironment = System.getenv("DATABASE_URL");
    if (fromEnvironment != null && !fromEnvironment.trim().isEmpty()) {
      return fromEnvironment.trim();
    }
    String fromProperty = System.getProperty("an5.connectionString");
    if (fromProperty != null && !fromProperty.trim().isEmpty()) {
      return fromProperty.trim();
    }
    throw new IllegalStateException(
        "No connection string: set DATABASE_URL or the an5.connectionString system property.");
  }
}
`;
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, 'An5Config.java'), content);
    }
    // ─── DbContext ───────────────────────────────────────────────────────────────────
    modelClientSource() {
        return `// This file is auto-generated. Do not edit directly.
package an5.client;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import an5.adapters.An5Aggregate;
import an5.adapters.An5GroupBy;
import an5.adapters.An5Query;
import an5.adapters.An5TableClient;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import an5.adapters.An5Adapter;
import an5.adapters.An5Aggregate;
import an5.adapters.An5GroupBy;
import an5.adapters.An5Query;
import an5.adapters.An5TableClient;

/**
 * A typed client for one model.
 *
 * <p>The row shape is supplied by the model class, so this stays generic: {@code findMany}
 * hands back {@code List<User>} rather than untyped maps, and {@code create} takes a
 * {@code User}.
 */
public final class ModelClient<T> {

  private final An5TableClient table;
  private final Function<Map<String, Object>, T> fromRow;
  private final Function<T, Map<String, Object>> toValues;

  ModelClient(
      An5TableClient table,
      Function<Map<String, Object>, T> fromRow,
      Function<T, Map<String, Object>> toValues) {
    this.table = table;
    this.fromRow = fromRow;
    this.toValues = toValues;
  }

  /** The model name this client reads and writes. */
  public String model() {
    return table.modelName();
  }

  public List<T> findMany() throws SQLException {
    return findMany(new An5Query());
  }

  public List<T> findMany(An5Query query) throws SQLException {
    return map(table.findMany(query));
  }

  public T findFirst(An5Query query) throws SQLException {
    return one(table.findFirst(query));
  }

  public T findFirst(Map<String, Object> where) throws SQLException {
    return one(table.findFirst(where));
  }

  public T findUnique(Map<String, Object> where) throws SQLException {
    return one(table.findUnique(where));
  }

  public long count(Map<String, Object> where) throws SQLException {
    return table.count(where);
  }

  /** Inserts a value and returns it as stored. */
  public T create(T value) throws SQLException {
    return one(table.create(toValues.apply(value)));
  }

  /** Inserts a value and returns it with the relations the query asked for. */
  public T create(T value, An5Query query) throws SQLException {
    return one(table.create(toValues.apply(value), query));
  }

  /** Inserts many values, one statement each. */
  public int createMany(List<T> values, boolean skipDuplicates) throws SQLException {
    List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
    for (T value : values) {
      rows.add(toValues.apply(value));
    }
    return affected(table.createMany(rows, skipDuplicates));
  }

  /** Updates the matching rows and returns the first of them re-read. */
  public T update(Map<String, Object> where, T value) throws SQLException {
    return one(table.update(where, toValues.apply(value)));
  }

  public T update(Map<String, Object> where, T value, An5Query query) throws SQLException {
    return one(table.update(new An5Query().where(where), toValues.apply(value), query));
  }

  /** Updates every matching row and gives back how many changed. */
  public int updateMany(Map<String, Object> where, T value) throws SQLException {
    return affected(table.updateMany(where, toValues.apply(value)));
  }

  /** Deletes the matching rows and returns the one that was there first. */
  public T delete(Map<String, Object> where) throws SQLException {
    return one(table.delete(where));
  }

  /** Deletes every matching row, or the whole table when \`where\` is \`null\`. */
  public int deleteMany(Map<String, Object> where) throws SQLException {
    return affected(table.deleteMany(where));
  }

  /** Updates the matching row when it exists, creates it otherwise. */
  public T upsert(Map<String, Object> where, T create, T update) throws SQLException {
    return one(table.upsert(where, toValues.apply(create), toValues.apply(update)));
  }

  /** One row of aggregate values, keyed \`_count\`, \`_sum_<field>\` and so on. */
  public Map<String, Object> aggregate(An5Aggregate aggregate) throws SQLException {
    return table.aggregate(aggregate);
  }

  /** One row per group. */
  public List<Map<String, Object>> groupBy(An5GroupBy group) throws SQLException {
    return table.groupBy(group);
  }

  /** The rows nearest a vector. */
  public List<T> vectorSearch(
      double[] vector, Integer take, Map<String, Object> where, String vectorField, String metric)
      throws SQLException {
    return map(table.vectorSearch(vector, take, where, vectorField, metric));
  }

  public List<T> vectorSearch(double[] vector, Integer take) throws SQLException {
    return vectorSearch(vector, take, null, "embedding", "cosine");
  }

  private List<T> map(List<Map<String, Object>> rows) {
    List<T> mapped = new ArrayList<T>();
    for (Map<String, Object> row : rows) {
      mapped.add(fromRow.apply(row));
    }
    return mapped;
  }

  private T one(Map<String, Object> row) {
    return row == null ? null : fromRow.apply(row);
  }

  private static int affected(Map<String, Object> result) {
    Object value = result.get("count");
    return value instanceof Number ? ((Number) value).intValue() : 0;
  }
}
`;
    }
    generateDbContext(models) {
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, 'ModelClient.java'), this.modelClientSource());
        let content = `// This file is auto-generated. Do not edit directly.
package an5.client;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import an5.adapters.An5Adapter;

/**
 * The AN5 entry point: one typed client per model, over one connection.
 *
 * <pre>
 * try (An5DbContext db = new An5DbContext(An5Config.connectionString())) {
 *   User ada = db.getUser().findUnique(Filters.eq("name", "Ada"));
 * }
 * </pre>
 */
public class An5DbContext implements AutoCloseable {

  private final An5Adapter adapter;
`;
        const declared = new Set();
        for (const model of models) {
            const property = this.propertyNames(model.name)[0];
            if (declared.has(property))
                continue;
            declared.add(property);
            content += `  private final ModelClient<${model.name}> ${property}Client;\n`;
        }
        content += `
  /** Opens a context, registering this schema with the adapter. */
  public An5DbContext(String connectionString) {
    An5Metadata.register();
    this.adapter = new An5Adapter(connectionString);
`;
        const assigned = new Set();
        for (const model of models) {
            const property = this.propertyNames(model.name)[0];
            if (assigned.has(property))
                continue;
            assigned.add(property);
            content += `    this.${property}Client = new ModelClient<${model.name}>(\n`;
            content += `        adapter.table("${model.name}"), ${model.name}::fromRow, ${model.name}::toValues);\n`;
        }
        content += `  }

  /** Wraps an adapter the caller already opened. */
  public An5DbContext(An5Adapter adapter) {
    An5Metadata.register();
    this.adapter = adapter;
`;
        const wrapped = new Set();
        for (const model of models) {
            const property = this.propertyNames(model.name)[0];
            if (wrapped.has(property))
                continue;
            wrapped.add(property);
            content += `    this.${property}Client = new ModelClient<${model.name}>(\n`;
            content += `        adapter.table("${model.name}"), ${model.name}::fromRow, ${model.name}::toValues);\n`;
        }
        content += `  }

  /** The underlying adapter, for raw SQL and for tables outside this schema. */
  public An5Adapter adapter() {
    return adapter;
  }

  /** The dialect the connection string points at. */
  public an5.adapters.base.Dialect dialect() {
    return adapter.dialect();
  }
`;
        const exposed = new Set();
        for (const model of models) {
            const property = this.propertyNames(model.name)[0];
            if (exposed.has(property))
                continue;
            exposed.add(property);
            const accessor = `get${this.capitalize(property)}`;
            content += `
  /** Queries for \`${model.name}\`. */
  public ModelClient<${model.name}> ${accessor}() {
    return this.${property}Client;
  }
`;
        }
        content += `
  /** A typed client for a table outside this schema. */
  public <T> ModelClient<T> table(
      String model, Function<Map<String, Object>, T> fromRow, Function<T, Map<String, Object>> toValues) {
    return new ModelClient<T>(adapter.table(model), fromRow, toValues);
  }

  /** A read-only client for a database view. */
  public an5.adapters.An5ViewClient view(String viewName) {
    return adapter.view(viewName);
  }

  /** Runs a query and returns its rows keyed by column label. */
  public List<Map<String, Object>> queryRaw(String sql, Object... parameters) throws SQLException {
    return adapter.queryRaw(sql, parameters);
  }

  /** Runs a statement that returns no rows. */
  public int executeRaw(String sql, Object... parameters) throws SQLException {
    return adapter.executeRaw(sql, parameters);
  }

  /** Runs work inside a transaction, committing on return and rolling back on failure. */
  public <T> T transaction(An5Adapter.TransactionWork<T> work) throws SQLException {
    return adapter.transaction(work);
  }

  @Override
  public void close() {
    adapter.close();
  }
}
`;
        fs_1.default.writeFileSync(path_1.default.join(this.outputDir, 'An5DbContext.java'), content);
    }
    // ─── Helpers ─────────────────────────────────────────────────────────────────────
    tableName(model) {
        return model.schemaName ? `${model.schemaName}.${model.tableName}` : model.tableName;
    }
}
exports.JavaGenerator = JavaGenerator;
/** Java keywords and literals that cannot be used as identifiers. */
const JAVA_RESERVED = new Set([
    'Abstract', 'Assert', 'Boolean', 'Break', 'Byte', 'Case', 'Catch', 'Char', 'Class', 'Const',
    'Continue', 'Default', 'Do', 'Double', 'Else', 'Enum', 'Equals', 'Extends', 'False', 'Final',
    'Finally', 'Float', 'For', 'Goto', 'If', 'Implements', 'Import', 'Instanceof', 'Int',
    'Interface', 'Long', 'Native', 'New', 'Null', 'Package', 'Private', 'Protected', 'Public',
    'Return', 'Short', 'Static', 'Strictfp', 'Super', 'Switch', 'Synchronized', 'This', 'Throw',
    'Throws', 'Transient', 'True', 'Try', 'Void', 'Volatile', 'While',
]);
function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
/**
 * The boxed form of a Java type.
 *
 * Capitalising is not boxing: `int` becomes `Integer`, not `Int`, and a generated model full
 * of `Int` does not compile.
 */
function box(type) {
    const boxed = {
        int: 'Integer',
        long: 'Long',
        short: 'Short',
        byte: 'Byte',
        double: 'Double',
        float: 'Float',
        boolean: 'Boolean',
        char: 'Character',
    };
    return boxed[type] ?? type;
}
function lowerFirst(value) {
    return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}
/** A Java string literal for a schema description. */
function javaString(value) {
    return JSON.stringify(value);
}
/**
 * Doc-comment text.
 *
 * A comment terminator inside a description would end this comment early and leave the
 * rest of the line as code, so it is split.
 */
function escapeDoc(value) {
    return value.replace(/\*\//g, '*\\/').replace(/\r?\n/g, ' ');
}
