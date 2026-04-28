import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: {
		SUPABASE_URL: 'https://example.supabase.co',
		SUPABASE_SERVICE_ROLE_KEY: 'service-role'
	}
}));

vi.mock('@supabase/supabase-js', () => ({
	createClient: (...args: unknown[]) => createClientMock(...args)
}));

type QueryResult<T> = {
	data: T;
	error: { message: string } | null;
};

function createSupabaseMock(
	exactResult: QueryResult<unknown>,
	candidateResult: QueryResult<unknown[] | null>
) {
	const calls = {
		exact: [] as Array<{ table: string; select: string; column: string; value: string }>,
		candidate: [] as Array<{ table: string; select: string; column: string; pattern: string }>
	};

	const client = {
		from: vi.fn((table: string) => ({
			select: vi.fn((select: string) => ({
				eq: vi.fn((column: string, value: string) => {
					calls.exact.push({ table, select, column, value });
					return {
						maybeSingle: vi.fn(async () => exactResult)
					};
				}),
				ilike: vi.fn(async (column: string, pattern: string) => {
					calls.candidate.push({ table, select, column, pattern });
					return candidateResult;
				})
			}))
		}))
	};

	return { client, calls };
}

async function loadDbModule(client: unknown) {
	vi.resetModules();
	createClientMock.mockReset();
	createClientMock.mockReturnValue(client);
	return import('./db');
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getTradePartnerAuthByEmail', () => {
	it('returns the exact normalized match without a fallback scan', async () => {
		const { client, calls } = createSupabaseMock(
			{
				data: {
					id: 'tp-1',
					email: 'ray@example.com',
					password_hash: '  stored-hash  '
				},
				error: null
			},
			{ data: [], error: null }
		);
		const { getTradePartnerAuthByEmail } = await loadDbModule(client);

		const tradePartner = await getTradePartnerAuthByEmail(' Ray@Example.com ');

		expect(tradePartner).toEqual({
			id: 'tp-1',
			email: 'ray@example.com',
			password_hash: 'stored-hash'
		});
		expect(calls.exact).toEqual([
			{
				table: 'trade_partners',
				select: 'id, email, password_hash, phone',
				column: 'email',
				value: 'ray@example.com'
			}
		]);
		expect(calls.candidate).toEqual([]);
	});

	it('falls back to a narrow candidate query for whitespace-padded legacy emails', async () => {
		const { client, calls } = createSupabaseMock(
			{ data: null, error: null },
			{
				data: [
					{
						id: 'tp-1',
						email: '  Ray@Example.com  ',
						password_hash: ' legacy-hash '
					}
				],
				error: null
			}
		);
		const { getTradePartnerAuthByEmail } = await loadDbModule(client);

		const tradePartner = await getTradePartnerAuthByEmail('ray@example.com');

		expect(tradePartner).toEqual({
			id: 'tp-1',
			email: 'ray@example.com',
			password_hash: 'legacy-hash'
		});
		expect(calls.candidate).toEqual([
			{
				table: 'trade_partners',
				select: 'id, email, password_hash, phone',
				column: 'email',
				pattern: '%ray@example.com%'
			}
		]);
	});

	it('returns null when neither the exact nor candidate query finds a match', async () => {
		const { client, calls } = createSupabaseMock(
			{ data: null, error: null },
			{ data: [], error: null }
		);
		const { getTradePartnerAuthByEmail } = await loadDbModule(client);

		const tradePartner = await getTradePartnerAuthByEmail('missing@example.com');

		expect(tradePartner).toBeNull();
		expect(calls.exact).toHaveLength(1);
		expect(calls.candidate).toEqual([
			{
				table: 'trade_partners',
				select: 'id, email, password_hash, phone',
				column: 'email',
				pattern: '%missing@example.com%'
			}
		]);
	});
});
