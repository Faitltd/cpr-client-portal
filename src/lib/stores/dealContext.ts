import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'admin_selected_deal_id';

function createDealContext() {
	const initial = browser ? localStorage.getItem(STORAGE_KEY) ?? '' : '';
	const { subscribe, set, update } = writable(initial);

	return {
		subscribe,
		set(value: string) {
			set(value);
			if (browser) {
				if (value) {
					localStorage.setItem(STORAGE_KEY, value);
				} else {
					localStorage.removeItem(STORAGE_KEY);
				}
			}
		},
		update
	};
}

export const selectedDealId = createDealContext();
