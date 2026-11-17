export type OwnPhotoSensitivity = 'strict' | 'balanced' | 'wide';
export type OwnPhotoCategory = 'female' | 'male';

export type IndexedFace = {
    driveFileId: string;
    faceIndex: number;
    embedding: number[];
    boundingBox?: { x?: number; y?: number; width: number; height: number } | null;
};

export type OwnPhotoMatches = Record<OwnPhotoSensitivity, Record<OwnPhotoCategory, string[]>>;

export function ownPhotoReferenceSignature(fileId: string, femaleIndex: number, maleIndex: number, photoVersion: string): string {
    return JSON.stringify(['v5-reference-consensus', fileId, femaleIndex, maleIndex, photoVersion]);
}

// Keep these values aligned with worker/face-recognition/engine.py.
const thresholds: Record<OwnPhotoSensitivity, number> = { strict: 0.5, balanced: 0.637, wide: 0.68 };
// Close scores cannot reliably distinguish which client a face belongs to.
const identityMargins: Record<OwnPhotoSensitivity, number> = { strict: 0.06, balanced: 0.04, wide: 0.02 };
const sensitivities = ['strict', 'balanced', 'wide'] as const;

function unit(vector: number[]): number[] | null {
    if (vector.length !== 128 || vector.some((value) => !Number.isFinite(value))) return null;
    const length = Math.hypot(...vector);
    return length > 0 ? vector.map((value) => value / length) : null;
}

function distance(left: number[], right: number[]): number {
    let similarity = 0;
    for (let index = 0; index < 128; index++) similarity += left[index]! * right[index]!;
    return Math.max(0, Math.min(2, 1 - similarity));
}

function identitySupport(seed: number[], opposite: number[], candidates: Array<{ vector: number[]; photoId: string }>, referenceFileId: string): number[][] {
    return candidates
        .filter((candidate) => candidate.photoId !== referenceFileId && distance(candidate.vector, seed) < 0.42 && distance(candidate.vector, opposite) > 0.6)
        .sort((left, right) => distance(left.vector, seed) - distance(right.vector, seed))
        .slice(0, 32)
        .map((candidate) => candidate.vector);
}

function identityPrototype(seed: number[], support: number[][]): number[] {
    if (support.length < 5) return seed;
    const mean = unit(Array.from({ length: 128 }, (_, index) =>
        (seed[index]! + support.reduce((sum, face) => sum + face[index]!, 0)) / (support.length + 1)));
    return mean && distance(mean, seed) <= 0.25 ? mean : seed;
}

function couldBePartner(candidate: number[], partner: number[], support: number[][]): boolean {
    // A weak profile or tiny face can miss the normal match threshold. Exclude
    // that uncertain photo from the individual category when it resembles the
    // partner; a clearly unrelated detected guest remains eligible.
    return Math.min(distance(candidate, partner), ...support.map((face) => distance(candidate, face))) < 0.85;
}

function identityScore(candidate: number[], seed: number[], prototype: number[], threshold: number): number {
    const seedDistance = distance(candidate, seed);
    if (prototype === seed) return seedDistance <= threshold ? seedDistance : Infinity;
    const prototypeDistance = distance(candidate, prototype);
    if (Math.max(seedDistance, prototypeDistance) > threshold + 0.05 ||
        Math.min(seedDistance, prototypeDistance) > threshold + 0.02) return Infinity;
    return (seedDistance + prototypeDistance) / 2;
}

export function buildOwnPhotoResults(
    orderedPhotoIds: string[],
    faces: IndexedFace[],
    referenceFileId: string,
    femaleFaceIndex: number,
    maleFaceIndex: number,
    soloPhotoIds: ReadonlySet<string>,
): OwnPhotoMatches | null {
    if (!referenceFileId || femaleFaceIndex === maleFaceIndex) return null;
    const byPhoto = new Map<string, Array<{ vector: number[]; index: number }>>();
    const allFaces: Array<{ vector: number[]; photoId: string }> = [];
    for (const face of faces) {
        const vector = unit(face.embedding);
        if (!vector) continue;
        const entries = byPhoto.get(face.driveFileId) || [];
        entries.push({ vector, index: face.faceIndex });
        byPhoto.set(face.driveFileId, entries);
        allFaces.push({ vector, photoId: face.driveFileId });
    }
    const referenceFaces = byPhoto.get(referenceFileId) || [];
    const female = referenceFaces.find((face) => face.index === femaleFaceIndex)?.vector;
    const male = referenceFaces.find((face) => face.index === maleFaceIndex)?.vector;
    if (!female || !male) return null;
    const femaleSupport = identitySupport(female, male, allFaces, referenceFileId);
    const maleSupport = identitySupport(male, female, allFaces, referenceFileId);
    const femalePrototype = identityPrototype(female, femaleSupport);
    const malePrototype = identityPrototype(male, maleSupport);

    const matches: OwnPhotoMatches = {
        strict: { female: [], male: [] },
        balanced: { female: [], male: [] },
        wide: { female: [], male: [] },
    };
    for (const photoId of orderedPhotoIds) {
        const candidates = byPhoto.get(photoId) || [];
        // One visible client face plus another person with no detected face could
        // still be the partner. Keep that photo in All Photos until both faces
        // can be identified; guests with detected faces remain eligible.
        if (candidates.length === 1 && !soloPhotoIds.has(photoId)) continue;
        for (const sensitivity of sensitivities) {
            let hasFemale = false;
            let hasMale = false;
            const unidentified: number[][] = [];
            for (const candidate of candidates) {
                const femaleDistance = identityScore(candidate.vector, female, femalePrototype, thresholds[sensitivity]);
                const maleDistance = identityScore(candidate.vector, male, malePrototype, thresholds[sensitivity]);
                // One detected face can represent one client only.
                if ((!Number.isFinite(femaleDistance) && !Number.isFinite(maleDistance)) ||
                    Math.abs(femaleDistance - maleDistance) < identityMargins[sensitivity]) {
                    unidentified.push(candidate.vector);
                    continue;
                }
                if (femaleDistance < maleDistance) hasFemale = true;
                if (maleDistance < femaleDistance) hasMale = true;
            }
            if (hasFemale && !hasMale && !unidentified.some((face) => couldBePartner(face, male, maleSupport))) matches[sensitivity].female.push(photoId);
            else if (hasMale && !hasFemale && !unidentified.some((face) => couldBePartner(face, female, femaleSupport))) matches[sensitivity].male.push(photoId);
        }
    }
    return matches;
}
