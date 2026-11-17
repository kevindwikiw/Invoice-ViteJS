import { expect, test } from 'bun:test';
import { buildOwnPhotoResults, type IndexedFace } from './own-photo';

const axis = (index: number): number[] => Array.from({ length: 128 }, (_, item) => item === index ? 1 : 0);
const near = (similarity: number): number[] => Array.from({ length: 128 }, (_, item) => item === 0 ? similarity : item === 2 ? Math.sqrt(1 - similarity ** 2) : 0);
const vector = (parts: Record<number, number>): number[] => { const values = Array.from({ length: 128 }, (_, index) => parts[index] || 0); const norm = Math.hypot(...values); return values.map((value) => value / norm); };
const face = (driveFileId: string, faceIndex: number, embedding: number[], area = 100): IndexedFace => ({
    driveFileId, faceIndex, embedding, boundingBox: { width: area, height: 1 },
});

test('Foto Sendiri separates Cewe and Cowo across cameras and allows guests', () => {
    const photos = ['guest', 'reference', 'camera1-female', 'camera2-male', 'female-group', 'female-crowd', 'male-group', 'couple-group', 'ambiguous', 'near-ambiguous', 'balanced', 'wide'];
    const faces = [
        face('guest', 0, axis(3)),
        face('reference', 0, axis(0), 200), face('reference', 1, axis(1), 180),
        face('camera1-female', 0, axis(0)), face('camera2-male', 0, axis(1)),
        face('female-group', 0, axis(0)), face('female-group', 1, axis(3)),
        face('female-crowd', 0, axis(0)), face('female-crowd', 1, axis(3)), face('female-crowd', 2, axis(4)), face('female-crowd', 3, axis(5)),
        face('male-group', 0, axis(1)), face('male-group', 1, axis(3)),
        face('couple-group', 0, axis(0)), face('couple-group', 1, axis(1)), face('couple-group', 2, axis(3)),
        face('ambiguous', 0, Array.from({ length: 128 }, (_, i) => i === 0 || i === 1 ? Math.SQRT1_2 : 0)),
        face('near-ambiguous', 0, Array.from({ length: 128 }, (_, i) => i === 0 ? 0.7 : i === 1 ? 0.69 : 0)),
        face('balanced', 0, near(0.4)), face('wide', 0, near(0.34)),
    ];
    const result = buildOwnPhotoResults(photos, faces, 'reference', 0, 1, new Set(['camera1-female', 'camera2-male', 'balanced', 'wide']));
    expect(result?.strict).toEqual({ female: ['camera1-female', 'female-group', 'female-crowd'], male: ['camera2-male', 'male-group'] });
    expect(result?.balanced.female).toEqual(['camera1-female', 'female-group', 'female-crowd', 'balanced']);
    expect(result?.wide.female).toEqual(['camera1-female', 'female-group', 'female-crowd', 'balanced', 'wide']);
    expect(result?.wide.female).not.toContain('couple-group');
    expect(result?.wide.male).not.toContain('couple-group');
});

test('an invalid explicit reference never falls back to an unrelated pair', () => {
    expect(buildOwnPhotoResults(['one', 'two'], [face('one', 0, axis(0)), face('two', 0, axis(0)), face('two', 1, axis(1))], 'one', 0, 1, new Set())).toBeNull();
    expect(buildOwnPhotoResults(['two'], [face('two', 0, axis(0)), face('two', 1, axis(1))], 'two', 0, 0, new Set())).toBeNull();
});

test('one detected client face with another unrecognized person stays out of individual categories', () => {
    const faces = [
        face('reference', 0, axis(0)), face('reference', 1, axis(1)),
        face('female-with-hidden-male', 0, axis(0)),
        face('male-with-hidden-female', 0, axis(1)),
        face('female-alone', 0, axis(0)),
        face('female-with-guest', 0, axis(0)), face('female-with-guest', 1, axis(3)),
        face('male-with-guest', 0, axis(1)), face('male-with-guest', 1, axis(3)),
    ];
    const photos = ['reference', 'female-with-hidden-male', 'male-with-hidden-female', 'female-alone', 'female-with-guest', 'male-with-guest'];
    const result = buildOwnPhotoResults(photos, faces, 'reference', 0, 1, new Set(['female-alone']));
    for (const sensitivity of ['strict', 'balanced', 'wide'] as const) {
        expect(result?.[sensitivity]).toEqual({ female: ['female-alone', 'female-with-guest'], male: ['male-with-guest'] });
    }
});

test('consistent gallery examples recover a weak client pose without matching a lookalike guest', () => {
    const maleSupport = vector({ 1: 0.72, 2: 0.69 });
    const maleProfile = vector({ 1: 0.33, 2: 0.6, 3: 0.73 });
    const guest = vector({ 1: 0.4, 2: -0.3, 4: 0.866 });
    const supportIds = Array.from({ length: 6 }, (_, index) => `male-support-${index}`);
    const photos = ['reference', ...supportIds, 'profile-couple', 'guest'];
    const faces = [
        face('reference', 0, axis(0)), face('reference', 1, axis(1)),
        ...supportIds.map((id) => face(id, 0, maleSupport)),
        face('profile-couple', 0, axis(0)), face('profile-couple', 1, maleProfile),
        face('guest', 0, guest),
    ];
    const result = buildOwnPhotoResults(photos, faces, 'reference', 0, 1, new Set([...supportIds, 'guest']));
    expect(result?.balanced.female).not.toContain('profile-couple');
    expect(result?.balanced.male).not.toContain('profile-couple');
    expect(result?.balanced.male).not.toContain('guest');
    expect(result?.balanced.female).not.toContain('guest');
});

test('uncertain partner face keeps a couple photo out of individual categories', () => {
    const weakMale = vector({ 1: 0.1, 2: 0.3, 3: 0.95 });
    const maleSupport = vector({ 1: 0.8, 2: 0.6 });
    const supportIds = Array.from({ length: 6 }, (_, index) => `male-support-${index}`);
    const faces = [
        face('reference', 0, axis(0)), face('reference', 1, axis(1)),
        ...supportIds.map((id) => face(id, 0, maleSupport)),
        face('uncertain-couple', 0, axis(0)), face('uncertain-couple', 1, weakMale),
        face('female-with-guest', 0, axis(0)), face('female-with-guest', 1, axis(4)),
    ];
    const result = buildOwnPhotoResults(['reference', ...supportIds, 'uncertain-couple', 'female-with-guest'], faces, 'reference', 0, 1, new Set());
    expect(result?.balanced.female).toEqual(['female-with-guest']);
    expect(result?.balanced.male).not.toContain('uncertain-couple');
});
