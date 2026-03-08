// Workaround for TS1540: Dexie's .d.ts uses 'module' keyword which TS 5.5+ rejects.
// This file suppresses the error by re-declaring the Dexie module.
declare module 'dexie' {
  export class Dexie {
    constructor(databaseName: string);
    version(versionNumber: number): {
      stores(schema: Record<string, string>): any;
      upgrade(fn: (trans: any) => void): any;
    };
    table(name: string): any;
    transaction(mode: string, ...args: any[]): any;
    open(): Promise<this>;
    close(): void;
    delete(): Promise<void>;
    on: any;
  }

  export class Table<T = any, TKey = any> {
    add(item: T, key?: TKey): Promise<TKey>;
    bulkAdd(items: T[], keys?: TKey[]): Promise<TKey>;
    bulkDelete(keys: TKey[]): Promise<void>;
    bulkPut(items: T[], keys?: TKey[]): Promise<TKey>;
    clear(): Promise<void>;
    count(): Promise<number>;
    delete(key: TKey): Promise<void>;
    each(callback: (item: T) => void): Promise<void>;
    filter(fn: (item: T) => boolean): {
      toArray(): Promise<T[]>;
      count(): Promise<number>;
      sortBy(keyPath: string): Promise<T[]>;
    };
    get(key: TKey): Promise<T | undefined>;
    put(item: T, key?: TKey): Promise<TKey>;
    toArray(): Promise<T[]>;
    toCollection(): {
      primaryKeys(): Promise<TKey[]>;
      count(): Promise<number>;
    };
    update(key: TKey, changes: Partial<T>): Promise<number>;
    where(keyPath: string): {
      equals(value: any): {
        toArray(): Promise<T[]>;
        first(): Promise<T | undefined>;
        count(): Promise<number>;
      };
      above(value: any): any;
      below(value: any): any;
      between(lower: any, upper: any): any;
      anyOf(values: any[]): any;
    };
  }

  export default Dexie;
}
