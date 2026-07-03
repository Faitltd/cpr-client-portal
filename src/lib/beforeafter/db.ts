import { openDB, type IDBPDatabase } from 'idb';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
	if (!dbPromise) {
		dbPromise = openDB('beforeafter', 1, {
			upgrade(db) {
				db.createObjectStore('pairs', { keyPath: 'id', autoIncrement: true });
			}
		});
	}
	return dbPromise;
}

// iOS Safari can fail storing Blob/File objects directly ("Error preparing
// Blob/File data to be stored in object store"), so we persist raw bytes.
export async function savePair(before: Blob, after: Blob) {
	const db = await getDB();
	return db.put('pairs', {
		before: await before.arrayBuffer(),
		beforeType: before.type || 'image/jpeg',
		after: await after.arrayBuffer(),
		afterType: after.type || 'image/jpeg',
		created: Date.now()
	});
}

export async function getAllPairs() {
	const db = await getDB();
	const rows: any[] = await db.getAll('pairs');
	return rows.map((r) => ({
		id: r.id,
		created: r.created,
		before:
			r.before instanceof Blob
				? r.before
				: new Blob([r.before], { type: r.beforeType || 'image/jpeg' }),
		after:
			r.after instanceof Blob
				? r.after
				: new Blob([r.after], { type: r.afterType || 'image/jpeg' })
	}));
}

export async function deletePair(id: number) {
	const db = await getDB();
	return db.delete('pairs', id);
}
