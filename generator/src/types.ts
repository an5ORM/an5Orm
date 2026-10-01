export interface Field {
  name: string;
  type: string;       // TypeScript type (string, number, boolean, Date, etc.)
  sqlType: string;    // SQL Server type (NVARCHAR(255), INT, DATETIME2, etc.)
  isOptional: boolean;
  hasDefault: boolean;
  isId: boolean;
  description?: string;
}

export interface Relation {
  name: string;
  type: string;
  isArray: boolean;
  isOptional: boolean;
  foreignKey: string;
  localKey: string;
  relationName: string;
  /** From a trailing @description("...") on the relation line. */
  description?: string;
}

export interface Model {
  name: string;
  tableName: string;
  schemaName: string;
  fields: Field[];
  relations: Relation[];
  compoundUniques?: string[][];
  description?: string;
}

/**
 * Tên bảng đã bọc ngoặc, dùng cho MSSQL và các client khác.
 *
 * `dbo` chỉ là schema mặc định của SQL Server. Khi `@@schema("")` — tức schema
 * rỗng, dành cho cơ sở dữ liệu không có khái niệm schema (SQLite, MySQL) — thì
 * phải bỏ hẳn tiền tố, vì `[].[users]` là SQL không hợp lệ. Trước đây công thức
 * `[${schemaName}].[${tableName}]` bị viết lặp ở 6 chỗ nên dialect nào cũng nhận
 * `[dbo]`, và trên SQLite mọi truy vấn hỏng với `no such table: dbo.<table>`.
 */
export function bracketedTableName(model: Model): string {
  return model.schemaName
    ? `[${model.schemaName}].[${model.tableName}]`
    : `[${model.tableName}]`;
}

/** Tên bảng dạng `schema.table`, cho các client truyền chuỗi thay vì SQL. */
export function dottedTableName(model: Model): string {
  return model.schemaName
    ? `${model.schemaName}.${model.tableName}`
    : model.tableName;
}
