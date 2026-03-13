import { browser } from '$app/environment';

interface DraftEntry<T> {
	data: T;
	savedAt: number;
}

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEBOUNCE_MS = 2000;

function isExpired(savedAt: number): boolean {
	return Date.now() - savedAt > EXPIRY_MS;
}

export interface DraftHandle<T> {
	load(): { data: T; savedAt: number } | null;
	save(data: T): void;
	scheduleSave(data: T): void;
	clear(): void;
	cancelPending(): void;
}

export function createDraft<T>(key: string, isEmpty: (data: T) => boolean): DraftHandle<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;

	function load(): { data: T; savedAt: number } | null {
		if (!browser) return null;
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return null;
			const entry: DraftEntry<T> = JSON.parse(raw);
			if (!entry || !entry.data || !entry.savedAt) return null;
			if (isExpired(entry.savedAt)) {
				localStorage.removeItem(key);
				return null;
			}
			return { data: entry.data, savedAt: entry.savedAt };
		} catch {
			return null;
		}
	}

	function save(data: T): void {
		if (!browser) return;
		if (isEmpty(data)) {
			localStorage.removeItem(key);
			return;
		}
		try {
			const entry: DraftEntry<T> = { data, savedAt: Date.now() };
			localStorage.setItem(key, JSON.stringify(entry));
		} catch {
			// localStorage full — silently ignore
		}
	}

	function scheduleSave(data: T): void {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			save(data);
			timer = null;
		}, DEBOUNCE_MS);
	}

	function clear(): void {
		if (timer) clearTimeout(timer);
		timer = null;
		if (browser) {
			try {
				localStorage.removeItem(key);
			} catch {
				// ignore
			}
		}
	}

	function cancelPending(): void {
		if (timer) clearTimeout(timer);
		timer = null;
	}

	return { load, save, scheduleSave, clear, cancelPending };
}
