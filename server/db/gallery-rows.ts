// Turso compat rows expose named columns as non-enumerable properties.
export function galleryRows<T>(columns: string[], rows: ArrayLike<unknown>[]): T[] {
    return rows.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])) as T);
}
