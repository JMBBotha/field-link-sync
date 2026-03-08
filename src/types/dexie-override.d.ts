declare module 'dexie' {
  class Dexie {
    constructor(databaseName: string);
    version(versionNumber: number): Dexie.Version;
    table<T = any, TKey = any>(name: string): Table<T, TKey>;
    transaction<U>(mode: 'rw' | 'r', table: Table<any, any>, scope: () => Promise<U>): Promise<U>;
    transaction<U>(mode: 'rw' | 'r', table1: Table<any, any>, table2: Table<any, any>, scope: () => Promise<U>): Promise<U>;
    open(): Promise<this>;
    close(): void;
    delete(): Promise<void>;
    on: any;
    static override: any;
  }

  namespace Dexie {
    interface Version {
      stores(schema: Record<string, string | null>): Version;
      upgrade(fn: (trans: any) => void): Version;
    }
  }

  class Table<T = any, TKey = any> {
    add(item: T, key?: TKey): Promise<TKey>;
    bulkAdd(items: T[], keys?: TKey[]): Promise<TKey>;
    bulkDelete(keys: TKey[]): Promise<void>;
    bulkPut(items: T[], keys?: TKey[]): Promise<TKey>;
    clear(): Promise<void>;
    count(): Promise<number>;
    delete(key: TKey): Promise<void>;
    each(callback: (item: T) => void): Promise<void>;
    filter(fn: (item: T) => boolean): Collection<T, TKey>;
    get(key: TKey): Promise<T | undefined>;
    put(item: T, key?: TKey): Promise<TKey>;
    toArray(): Promise<T[]>;
    toCollection(): Collection<T, TKey>;
    update(key: TKey, changes: Partial<T>): Promise<number>;
    where(keyPath: string): WhereClause<T, TKey>;
  }

  interface Collection<T = any, TKey = any> {
    toArray(): Promise<T[]>;
    count(): Promise<number>;
    sortBy(keyPath: string): Promise<T[]>;
    primaryKeys(): Promise<TKey[]>;
    first(): Promise<T | undefined>;
    filter(fn: (item: T) => boolean): Collection<T, TKey>;
  }

  interface WhereClause<T = any, TKey = any> {
    equals(value: any): Collection<T, TKey>;
    above(value: any): Collection<T, TKey>;
    below(value: any): Collection<T, TKey>;
    between(lower: any, upper: any): Collection<T, TKey>;
    anyOf(values: any[]): Collection<T, TKey>;
  }

  export { Dexie, Table, Collection, WhereClause };
  export default Dexie;
}
