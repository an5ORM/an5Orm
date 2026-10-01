"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bracketedTableName = bracketedTableName;
exports.dottedTableName = dottedTableName;
/**
 * Tên bảng đã bọc ngoặc, dùng cho MSSQL và các client khác.
 *
 * `dbo` chỉ là schema mặc định của SQL Server. Khi `@@schema("")` — tức schema
 * rỗng, dành cho cơ sở dữ liệu không có khái niệm schema (SQLite, MySQL) — thì
 * phải bỏ hẳn tiền tố, vì `[].[users]` là SQL không hợp lệ. Trước đây công thức
 * `[${schemaName}].[${tableName}]` bị viết lặp ở 6 chỗ nên dialect nào cũng nhận
 * `[dbo]`, và trên SQLite mọi truy vấn hỏng với `no such table: dbo.<table>`.
 */
function bracketedTableName(model) {
    return model.schemaName
        ? `[${model.schemaName}].[${model.tableName}]`
        : `[${model.tableName}]`;
}
/** Tên bảng dạng `schema.table`, cho các client truyền chuỗi thay vì SQL. */
function dottedTableName(model) {
    return model.schemaName
        ? `${model.schemaName}.${model.tableName}`
        : model.tableName;
}
