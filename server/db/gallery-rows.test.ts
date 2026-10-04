import { expect, test } from 'bun:test';
import { galleryRows } from './gallery-rows';

test('Turso non-enumerable aliases survive spreads and JSON like SQLite rows', () => {
    const columns = ['driveFileId', 'filename', 'folderId', 'displayOrder'];
    const values = ['drive-id', 'photo.jpg', null, 2];
    const row = [...values];
    columns.forEach((column, index) => Object.defineProperty(row, column, { value: values[index], enumerable: false }));
    const [photo] = galleryRows<Record<string, unknown>>(columns, [row]);
    expect(JSON.parse(JSON.stringify({ ...photo }))).toEqual({ driveFileId: 'drive-id', filename: 'photo.jpg', folderId: null, displayOrder: 2 });
    expect(Object.keys(photo!)).toEqual(columns);
    expect(galleryRows(columns, [])).toEqual([]);
});
