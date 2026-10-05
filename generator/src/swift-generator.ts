/**
 * The Swift client generator.
 *
 * Emits `an5Client/swift` sources that depend on the runtime in `an5Adapters/swift`:
 * a `struct` per model, typed filter builders, the metadata the runtime reads its tables
 * and columns from, and an `An5Db` that hands out one client per model.
 *
 * Models are value types with an explicit `init(row:)` rather than anything Codable: the
 * runtime's rows are keyed by column label and carry their own nullability, and a Codable
 * conformance would have to invent a second shape that agrees with neither.
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

/** Lower-cased words that would collide with a `CaseIterable` member or read oddly. */
const SWIFT_KEYWORDS = new Set([
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import',
  'init', 'inout', 'internal', 'let', 'open', 'operator', 'private', 'protocol', 'public',
  'rethrows', 'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'continue',
  'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat',
  'return', 'switch', 'where', 'while', 'as', 'catch', 'false', 'is', 'nil', 'super', 'self',
  'throw', 'throws', 'true', 'try',
]);

export class SwiftGenerator {
  /** The database being generated for; decides types like `TIMESTAMP`. */
  private provider: Provider | undefined;

  constructor(private outputDir: string) {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  public generate(models: Model[]): void {
    this.provider = models[0]?.provider;

    this.generatePackageManifest();
    this.generateModels(models);
    this.generateOrmTypes(models);
    this.generateMetadata(models);
    this.generateConfig();
    this.generateClient(models);
  }

  /**
   * The SwiftPM manifest for the generated client.
   *
   * <p>SwiftPM has no "point a build at this folder" story the way a csproj or a go.mod
   * does: a target's sources have to live under `Sources/<Target>/`. Emitting the manifest
   * and that layout together is what makes the output a package an app can depend on,
   * rather than a directory a consumer has to restructure by hand.
   */
  private generatePackageManifest(): void {
    fs.mkdirSync(this.sourceDir, { recursive: true });
    const content = `// swift-tools-version: 5.9
// This file is auto-generated. Do not edit deliberately.
import PackageDescription

let package = Package(
    name: "An5Client",
    products: [
        .library(name: "An5Client", targets: ["An5Client"])
    ],
    dependencies: [
        .package(url: "https://github.com/an5ORM/an5Adapters.git", from: "${ADAPTER_VERSION}")
    ],
    targets: [
        .target(name: "An5Client", dependencies: [
            .product(name: "An5Adapters", package: "an5Adapters")
        ])
    ]
)
`;
    fs.writeFileSync(path.join(this.outputDir, 'Package.swift'), content);
  }

  /** Where SwiftPM expects a target's sources. */
  private get sourceDir(): string {
    return path.join(this.outputDir, 'Sources', 'An5Client');
  }

  // ─── Naming ─────────────────────────────────────────────────────────────────────

  private capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  /**
   * The property name for a column.
   *
   * Backticked rather than renamed where possible: `default` and `class` are valid column
   * names, and renaming them in the model but not in the SQL is a mismatch nobody notices.
   */
  private property(name: string): string {
    const camel = SwiftGenerator.toCamelCase(name);
    return SWIFT_KEYWORDS.has(camel) ? `\`${camel}\`` : camel;
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
    return SwiftGenerator.toCamelCase(value);
  }

  // ─── Types ───────────────────────────────────────────────────────────────────────

  /** The Swift type for a column. */
  private mapType(field: Field): string {
    const base = declaredBase(field.sqlType ?? field.type);
    switch (fieldKind(field, this.provider)) {
      case 'int':
        return 'Int';
      case 'bigint':
        return 'Int64';
      case 'float':
        // `DECIMAL`/`NUMERIC`/`MONEY` stay exact; Swift's `Double` would round money.
        return ['DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY', 'FIXED'].includes(base)
          ? 'Decimal'
          : 'Double';
      case 'bool':
        return 'Bool';
      case 'date':
        if (base === 'DATE') return 'Date';
        return 'Date';
      case 'bytes':
        return 'Data';
      case 'vector':
        return '[Double]';
      case 'json':
        return 'String';
      default:
        return 'String';
    }
  }

  private mapOptionalType(field: Field): string {
    const mapped = this.mapType(field);
    return mapped.startsWith('[') ? mapped : `${mapped}?`;
  }

  /** How a column is read out of a row, as a Swift expression. */
  private readExpression(field: Field): string {
    const base = declaredBase(field.sqlType ?? field.type);
    switch (fieldKind(field, this.provider)) {
      case 'int':
        return `row.int("${field.name}")`;
      case 'bigint':
        return `row.int64("${field.name}")`;
      case 'float':
        return ['DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY', 'FIXED'].includes(base)
          ? `row.decimal("${field.name}")`
          : `row.double("${field.name}")`;
      case 'bool':
        return `row.bool("${field.name}")`;
      case 'date':
        return `row.date("${field.name}")`;
      case 'bytes':
        return `row.data("${field.name}")`;
      case 'vector':
        return `An5Values.vector(row["${field.name}"]) ?? []`;
      default:
        return `row.string("${field.name}")`;
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
      fs.writeFileSync(path.join(this.sourceDir, `${model.name}.swift`), this.modelSource(model));
    }
  }

  private modelSource(model: Model): string {
    const name = model.name;
    let content = `// This file is auto-generated. Do not edit deliberately.
import Foundation
import An5Adapters

/// ${model.description ? escapeDoc(model.description) : `The \`${name}\` model.`}
public struct ${name} {
`;

    for (const field of model.fields) {
      const property = this.property(field.name);
      const type = this.mapOptionalType(field);
      content += `    /// \`${field.sqlType}\`${field.isId ? ', primary key' : ''}${field.description ? ` — ${escapeDoc(field.description)}` : ''}\n`;
      content += `    public let ${property}: ${type}\n`;
    }

    for (const rel of model.relations) {
      const property = this.property(rel.name);
      const type = rel.isArray ? `[${rel.type}]` : `${rel.type}?`;
      content += `\n    /// Eager-loaded with \`include: ["${rel.name}": true]\`.\n`;
      content += `    public var ${property}: ${type} = ${rel.isArray ? '[]' : 'nil'}\n`;
    }

    content += `\n    public init(\n`;
    content += model.fields
      .map(
        (field) =>
          `        ${this.property(field.name)}: ${this.mapOptionalType(field)} = nil${field === model.fields[model.fields.length - 1] ? '' : ','}`
      )
      .join('\n');
    content += `\n    ) {\n`;
    content += model.fields
      .map((field) => `        self.${this.property(field.name)} = ${this.property(field.name)}`)
      .join('\n');
    content += `\n    }\n\n`;

    content += `    /// Reads \`${name}\` from a database row.\n`;
    content += `    ///\n`;
    content += `    /// Every column goes through a converter rather than a cast: a \`BOOL\` arrives as an\n`;
    content += `    /// \`Int\` on one driver and \`Bool\` on another, and a \`NUMERIC\` column still arrives\n`;
    content += `    /// as a \`Decimal\` even when it would fit in an \`Int\`.\n`;
    content += `    ///\n`;
    content += `    /// Eager-loaded relations arrive as nested rows and are converted the same way; one\n`;
    content += `    /// that was not asked for keeps its default, so an empty \`orders\` does not say\n`;
    content += `    /// whether the query included it.\n`;
    content += `    public init(row: Row) {\n`;
    content += model.fields
      .map((field) => `        self.${this.property(field.name)} = ${this.readExpression(field)}`)
      .join('\n');
    if (model.relations.length > 0) {
      content += '\n';
      for (const rel of model.relations) {
        const property = this.property(rel.name);
        if (rel.isArray) {
          content += `        self.${property} = row.related("${rel.name}").map { ${rel.type}(row: $0) }\n`;
        } else {
          content += `        self.${property} = row.relatedOne("${rel.name}").map { ${rel.type}(row: $0) }\n`;
        }
      }
    }
    content += `\n    }\n\n`;

    content += `    /// The columns to write, in declaration order, with \`nil\` left out.\n`;
    content += `    ///\n`;
    content += `    /// An unset column takes the schema's DEFAULT, which is what leaving it out means —\n`;
    content += `    /// and what \`update\` needs so a partial value does not blank every other column.\n`;
    content += `    public var values: Values {\n`;
    content += `        var values = Values()\n`;
    content += model.fields
      .map(
        (field) =>
          `        if let value = self.${this.property(field.name)} { values["${field.name}"] = value }`
      )
      .join('\n');
    content += `\n        return values\n    }\n}\n`;
    return content;
  }

  // ─── ORM types ───────────────────────────────────────────────────────────────────

  private generateOrmTypes(models: Model[]): void {
    let content = `// This file is auto-generated. Do not edit deliberately.
import Foundation
import An5Adapters

/// Typed filters for the generated models.
///
/// A filter is a small builder whose \`build()\` produces the filter tree the runtime's SQL
/// builder reads, so a query is checked at the call site and still compiles down to bind
/// parameters rather than interpolated SQL.
public enum An5Orm {

    /// A filter on a string column.
    public struct StringFilter {
        private var operators: Where = [:]

        public static func \`is\`(_ value: String?) -> StringFilter {
            var filter = StringFilter()
            filter.operators["equals"] = value
            return filter
        }

        public static func isNot(_ value: String?) -> StringFilter {
            var filter = StringFilter()
            filter.operators["not"] = value
            return filter
        }

        public static func has(_ value: String) -> StringFilter {
            var filter = StringFilter()
            filter.operators["contains"] = value
            return filter
        }

        public static func starts(_ value: String) -> StringFilter {
            var filter = StringFilter()
            filter.operators["startsWith"] = value
            return filter
        }

        public static func ends(_ value: String) -> StringFilter {
            var filter = StringFilter()
            filter.operators["endsWith"] = value
            return filter
        }

        public func inList(_ values: [String]) -> StringFilter {
            var filter = self
            filter.operators["in"] = values
            return filter
        }

        public func notInList(_ values: [String]) -> StringFilter {
            var filter = self
            filter.operators["notIn"] = values
            return filter
        }

        /// The filter as the runtime reads it.
        public func build() -> Where { operators }
    }

    /// A filter on an integer or floating-point column.
    public struct NumberFilter {
        private var operators: Where = [:]

        public static func \`is\`(_ value: Double?) -> NumberFilter {
            var filter = NumberFilter()
            filter.operators["equals"] = value
            return filter
        }

        public static func atLeast(_ value: Double?) -> NumberFilter {
            var filter = NumberFilter()
            filter.operators["gte"] = value
            return filter
        }

        public static func atMost(_ value: Double?) -> NumberFilter {
            var filter = NumberFilter()
            filter.operators["lte"] = value
            return filter
        }

        public static func greater(_ value: Double?) -> NumberFilter {
            var filter = NumberFilter()
            filter.operators["gt"] = value
            return filter
        }

        public static func less(_ value: Double?) -> NumberFilter {
            var filter = NumberFilter()
            filter.operators["lt"] = value
            return filter
        }

        public func inList(_ values: [Double]) -> NumberFilter {
            var filter = self
            filter.operators["in"] = values
            return filter
        }

        /// The filter as the runtime reads it.
        public func build() -> Where { operators }
    }

    /// A filter on a boolean column.
    public struct BoolFilter {
        private var operators: Where = [:]

        public static func \`is\`(_ value: Bool?) -> BoolFilter {
            var filter = BoolFilter()
            filter.operators["equals"] = value
            return filter
        }

        /// The filter as the runtime reads it.
        public func build() -> Where { operators }
    }

    /// A filter on a date column.
    public struct DateFilter {
        private var operators: Where = [:]

        public static func \`is\`(_ value: Date?) -> DateFilter {
            var filter = DateFilter()
            filter.operators["equals"] = value
            return filter
        }

        public static func atLeast(_ value: Date?) -> DateFilter {
            var filter = DateFilter()
            filter.operators["gte"] = value
            return filter
        }

        public static func atMost(_ value: Date?) -> DateFilter {
            var filter = DateFilter()
            filter.operators["lte"] = value
            return filter
        }

        /// The filter as the runtime reads it.
        public func build() -> Where { operators }
    }
`;

    for (const model of models) {
      const name = model.name;
      content += `
    /// A \`WHERE\` for ${name}. Unset filters are left out.
    public struct ${name}Where {
        private var operators: Where = [:]
${model.fields.map((field) => `        public var ${this.property(field.name)}: ${this.filterType(field)}?`).join('\n')}

        /// Creates a filter with every column unset; assign the ones you want to match.
        public init() {}

        public func and(_ clauses: ${name}Where...) -> ${name}Where {
            var filter = self
            filter.operators["AND"] = clauses.map { $0.build() }
            return filter
        }

        public func or(_ clauses: ${name}Where...) -> ${name}Where {
            var filter = self
            filter.operators["OR"] = clauses.map { $0.build() }
            return filter
        }

        public func not(_ clause: ${name}Where) -> ${name}Where {
            var filter = self
            filter.operators["NOT"] = [clause.build()]
            return filter
        }

        /// The filter tree as the runtime reads it.
        ///
        /// Column conditions are read from the properties here rather than written into
        /// \`operators\` as they are assigned, because a condition dropped on the way in is not
        /// an error — it is a filter that quietly matches every row.
        public func build() -> Where {
            var filter = operators
${model.fields
  .map((field) => {
    const property = this.property(field.name);
    return `            if let ${property} = ${property} { filter["${field.name}"] = ${property}.build() }`;
  })
  .join('\n')}
            return filter
        }
    }

    /// An \`ORDER BY\` for ${name}.
    public struct ${name}OrderBy {
        private var entries: [[String: String]] = []

        public init() {}

        /// Orders by the columns, ascending.
        public func asc(_ columns: String...) -> ${name}OrderBy {
            var order = self
            for column in columns { order.entries.append([column: "asc"]) }
            return order
        }

        /// Orders by the column, descending.
        public func desc(_ column: String) -> ${name}OrderBy {
            var order = self
            order.entries.append([column: "desc"])
            return order
        }

        /// The sort as the runtime reads it.
        public func build() -> [[String: String]] { entries }
    }
`;
    }

    content += `}\n`;
    fs.writeFileSync(path.join(this.sourceDir, 'An5OrmTypes.swift'), content);
  }

  // ─── Metadata ────────────────────────────────────────────────────────────────────

  private generateMetadata(models: Model[]): void {
    let content = `// This file is auto-generated. Do not edit deliberately.
import Foundation
import An5Adapters

/// The generated models' tables, columns and relations.
///
/// Passed to the runtime when a database is opened. Without it the table clients have no
/// table names to work with and no primary key to fill in.
public enum An5Metadata {

    /// Model name to table name, schema-qualified.
    public static let modelToTable: [String: String] = [
${models.map((model) => `        "${model.name}": "${this.tableName(model)}",`).join('\n')}
    ]

    /// Model name to its columns, as the runtime reads them.
    public static let modelFields: [String: [[String: Any?]]] = [
${models
  .map(
    (model) => `        "${model.name}": [
${model.fields
  .map(
    (field) =>
      `            ["name": "${field.name}", "type": "${field.type}", "sql": "${field.sqlType}", "isOptional": ${field.isOptional}, "hasDefault": ${field.hasDefault}, "isId": ${field.isId}${field.description ? `, "description": ${swiftString(field.description)}` : ''}],`
  )
  .join('\n')}
        ],`
  )
  .join('\n')}
    ]

    /// Model name to its relations, keyed by relation name.
    public static let relationMap: [String: [String: [String: String]]] = ${
        models.some((model) => model.relations.length > 0) ? '[' : '[:]'
    }
${
  models.some((model) => model.relations.length > 0)
    ? models
        .filter((model) => model.relations.length > 0)
        .map(
          (model) => `        "${model.name}": [
${model.relations
  .map(
    (rel) =>
      `            "${rel.name}": ["modelName": "${rel.type}", "relationType": "${rel.relationName}", "foreignKey": "${rel.foreignKey}", "localKey": "${rel.localKey}"],`
  )
  .join('\n')}
        ],`
        )
        .join('\n') + '\n    ]'
    : ''
}

    /// This schema, in the shape the runtime reads.
    public static var metadata: Metadata {
        Metadata([
            "modelToTable": modelToTable,
            "modelFields": modelFields,
            "relationMap": relationMap,
        ]) ?? .empty
    }
}
`;
    fs.writeFileSync(path.join(this.sourceDir, 'An5Metadata.swift'), content);
  }

  // ─── Config ──────────────────────────────────────────────────────────────────────

  private generateConfig(): void {
    const content = `// This file is auto-generated. Do not edit deliberately.
import Foundation
import An5Adapters

/// Where the connection string comes from.
///
/// The \`AN5_DATABASE_URL\` environment variable first, then the \`AN5_CONNECTION_STRING\`
/// Info.plist entry an app bundle carries, so one build can be pointed at a different
/// database without a recompile.
public enum An5Config {

    public static func connectionString() throws -> String {
        if let fromEnvironment = ProcessInfo.processInfo.environment["AN5_DATABASE_URL"],
           !fromEnvironment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return fromEnvironment.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let fromBundle = Bundle.main.object(forInfoDictionaryKey: "AN5_CONNECTION_STRING") as? String,
           !fromBundle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return fromBundle.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        throw An5Error.configuration(
            "no connection string: set AN5_DATABASE_URL or the AN5_CONNECTION_STRING Info.plist entry")
    }
}
`;
    fs.writeFileSync(path.join(this.sourceDir, 'An5Config.swift'), content);
  }

  // ─── Client ──────────────────────────────────────────────────────────────────────

  private generateClient(models: Model[]): void {
    let accessors = models.map((model) => ({
      property: SwiftGenerator.toLowerCamelCase(model.name),
      name: model.name,
    }));
    const unique = new Map<string, { property: string; name: string }>();
    for (const entry of accessors) {
      const key = SwiftGenerator.toLowerCamelCase(entry.name);
      if (!unique.has(key)) unique.set(key, { property: key, name: entry.name });
    }

    let content = `// This file is auto-generated. Do not edit deliberately.
import Foundation
import An5Adapters

/// A typed client for one model.
///
/// The runtime's \`TableClient\` works on untyped rows so it stays independent of the
/// schema; this adds the model's own type on top, which is what makes
/// \`db.${Array.from(unique.values())[0]?.property ?? 'user'}.findMany()\` come back as
/// \`[${models[0]?.name ?? 'User'}]\` rather than \`[Row]\`.
public struct ModelClient<T> {

    private let table: TableClient
    private let read: (Row) -> T
    private let write: (T) -> Values

    init(table: TableClient, read: @escaping (Row) -> T, write: @escaping (T) -> Values) {
        self.table = table
        self.read = read
        self.write = write
    }

    /// The model this client reads and writes.
    public var model: String { table.model }

    public func findMany() throws -> [T] { try table.findMany().map { read($0) } }

    public func findMany(_ query: Query) throws -> [T] { try table.findMany(query).map { read($0) } }

    public func findMany(filter: Where) throws -> [T] { try table.findMany(filter: filter).map { read($0) } }

    public func findFirst(_ query: Query = Query()) throws -> T? { try table.findFirst(query).map { read($0) } }

    public func findFirst(filter: Where) throws -> T? { try table.findFirst(filter: filter).map { read($0) } }

    public func findUnique(filter: Where) throws -> T? { try table.findUnique(filter: filter).map { read($0) } }

    public func count(_ filter: Where? = nil) throws -> Int { try table.count(filter) }

    /// Inserts a value and returns it as stored.
    @discardableResult
    public func create(_ value: T) throws -> T { read(try table.create(write(value))) }

    /// Inserts a value and returns it with the relations the query asked for.
    @discardableResult
    public func create(_ value: T, _ query: Query) throws -> T { read(try table.create(write(value), query)) }

    /// Inserts many values, one statement each.
    @discardableResult
    public func createMany(_ values: [T], skipDuplicates: Bool = false) throws -> Int {
        try table.createMany(values.map(write), skipDuplicates: skipDuplicates)
    }

    /// Updates the matching rows and returns the first of them re-read.
    @discardableResult
    public func update(filter: Where, data: T) throws -> T? { try table.update(filter: filter, data: write(data)).map { read($0) } }

    /// Updates every matching row and gives back how many changed.
    @discardableResult
    public func updateMany(filter: Where?, data: T) throws -> Int { try table.updateMany(filter: filter, data: write(data)) }

    /// Deletes the matching rows and returns the one that was there first.
    @discardableResult
    public func delete(filter: Where) throws -> T? { try table.delete(filter: filter).map { read($0) } }

    /// Deletes every matching row, or the whole table when \`filter\` is \`nil\`.
    @discardableResult
    public func deleteMany(filter: Where? = nil) throws -> Int { try table.deleteMany(filter: filter) }

    /// Updates the matching row when it exists, creates it otherwise.
    @discardableResult
    public func upsert(filter: Where, create: T, update: T) throws -> T {
        read(try table.upsert(filter: filter, create: write(create), update: write(update)))
    }

    /// One row of aggregate values, keyed \`_count\`, \`_sum_<field>\` and so on.
    public func aggregate(_ aggregate: Aggregate) throws -> Row { try table.aggregate(aggregate) }

    /// One row per group, each carrying the group's count and aggregates.
    public func groupBy(_ aggregate: Aggregate) throws -> [Row] { try table.groupBy(aggregate) }

    /// The rows nearest a vector.
    public func vectorSearch(
        _ vector: [Double],
        take: Int = 10,
        filter: Where? = nil,
        vectorField: String = "embedding",
        metric: DistanceMetric = .cosine
    ) throws -> [T] {
        try table.vectorSearch(vector, take: take, filter: filter, vectorField: vectorField, metric: metric).map { read($0) }
    }
}

/// The AN5 entry point: one typed client per model, over one connection.
///
/// \`\`\`
/// let db = try An5Db(path: ":memory:")
/// let ada = try db.user.findUnique(filter: ["name": "Ada"])
/// \`\`\`
public final class An5Db {

    /// The runtime underneath, for raw SQL and for anything the typed clients miss.
    public let an5: An5Adapter

${Array.from(unique.values())
  .map((entry) => `    /// Queries for \`${entry.name}\`.\n    public let ${entry.property}: ModelClient<${entry.name}>`)
  .join('\n\n')}

    /// Opens a database from a connection string, registering this schema with the runtime.
    public convenience init(connectionString: String) throws {
        let driver = try SQLiteDriver(path: An5Db.path(connectionString))
        self.init(adapter: An5Adapter(driver: driver,
                                          connectionString: connectionString,
                                          metadata: An5Metadata.metadata))
    }

    /// Opens an in-memory or on-disk database, registering this schema with the runtime.
    public convenience init(path: String) throws {
        let driver = try SQLiteDriver(path: path)
        self.init(adapter: An5Adapter(driver: driver,
                                          connectionString: "sqlite::memory:",
                                          metadata: An5Metadata.metadata))
    }

    /// Wraps a runtime the caller already opened.
    public init(adapter: An5Adapter) {
        self.an5 = adapter
${Array.from(unique.values())
  .map(
    (entry) =>
      `        self.${entry.property} = ModelClient(\n            table: adapter.table("${entry.name}"),\n            read: { ${entry.name}(row: $0) },\n            write: { $0.values })`
  )
  .join('\n')}
    }

    /// A typed client for a table outside this schema.
    public func table<T>(_ model: String, read: @escaping (Row) -> T, write: @escaping (T) -> Values) -> ModelClient<T> {
        ModelClient(table: an5.table(model), read: read, write: write)
    }

    /// A read-only client for a database view.
    public func view(_ name: String) -> ViewClient { an5.view(name) }

    /// The dialect the connection string points at.
    public var dialect: Dialect { an5.dialect }

    /// Runs a query and returns its rows keyed by column label.
    public func query(_ sql: String, _ parameters: [Any?] = []) throws -> [Row] {
        try an5.query(sql, parameters)
    }

    /// Runs a statement that returns no rows and gives back the affected row count.
    @discardableResult
    public func execute(_ sql: String, _ parameters: [Any?] = []) throws -> Int {
        try an5.execute(sql, parameters)
    }

    /// Runs \`body\` inside a transaction, committing on return and rolling back on failure.
    public func transaction<T>(_ body: (An5Adapter) throws -> T) throws -> T {
        try an5.transaction(body)
    }

    private static func path(_ connectionString: String) -> String {
        for prefix in ["sqlite:///", "sqlite://", "sqlite:"] where connectionString.hasPrefix(prefix) {
            return String(connectionString.dropFirst(prefix.count))
        }
        return connectionString
    }
}
`;
    fs.writeFileSync(path.join(this.sourceDir, 'An5Db.swift'), content);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────────

  private tableName(model: Model): string {
    return model.schemaName ? `${model.schemaName}.${model.tableName}` : model.tableName;
  }
}

/** The runtime version the generated client declares a dependency on. */
const ADAPTER_VERSION = '0.2.11';

/** A Swift string literal for a schema description. */
function swiftString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Doc-comment text.
 *
 * A comment terminator inside a description would end this comment early and leave the rest
 * of the line as code, so it is split.
 */
function escapeDoc(value: string): string {
  return value.replace(/\*\//g, '*\\/').replace(/\r?\n/g, ' ');
}