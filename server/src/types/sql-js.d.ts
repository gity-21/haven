declare module 'sql.js' {
    type SqlValue = number | string | Uint8Array | null;
    type BindParams = SqlValue[] | Record<string, SqlValue>;

    interface Database {
        run(sql: string, params?: BindParams): void;
        prepare(sql: string): Statement;
        export(): Uint8Array;
        getRowsModified(): number;
        close(): void;
    }

    interface Statement {
        bind(params?: BindParams): boolean;
        step(): boolean;
        getAsObject(params?: Record<string, unknown>): Record<string, unknown>;
        free(): void;
    }

    interface SqlJsStatic {
        Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
    }

    function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;

    namespace initSqlJs {
        export type BindParams = SqlValue[] | Record<string, SqlValue>;
    }

    export default initSqlJs;
    export { Database, Statement, BindParams, SqlValue, SqlJsStatic };
}
