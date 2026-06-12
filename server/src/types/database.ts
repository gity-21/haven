/**
 * server/src/types/database.ts — Veritabanı Model Tipleri
 *
 * SQLite tablolarındaki satırların TypeScript karşılıkları.
 * sql.js (WASM) ve better-sqlite3 wrapper'ından dönen verilerin tipleri.
 */

/** rooms tablosu */
export interface Room {
    room_key: string;
    password_hash: string;
    e2ee_salt: string | null;
    created_at: string; // ISO 8601 datetime
}

/** messages tablosu */
export interface Message {
    id: number;
    room_key: string;
    username: string;
    avatar_color: string;
    content: string;
    type: 'message' | 'file' | 'p2p-announce' | 'poll';
    reply_to: number | null;
    profile_pic: string | null;
    session_id: string | null;
    reactions: string; // JSON string: Record<string, string[]>
    user_id: string | null;
    user_secret: string | null;
    created_at: string;
}

/** messages JOIN (reply bilgisi dahil) sorgu sonucu */
export interface MessageWithReply extends Message {
    reply_username: string | null;
    reply_content: string | null;
}

/** Veritabanı wrapper (sql.js compatibility layer) arayüzü */
export interface DatabaseWrapper {
    prepare(sql: string): PreparedStatement;
    exec(sql: string): void;
    close(): void;
}

export interface PreparedStatement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
}

export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
}

/** Admin API: oda listesi sonucu */
export interface AdminRoomInfo {
    room_key: string;
    created_at: string;
    message_count: number;
    online_count: number;
}
