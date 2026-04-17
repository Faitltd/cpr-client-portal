import { normalizeClientPhonePassword } from './client-password';
import { setTradePartnerPassword, type TradePartnerAuth } from './db';
import { hashPassword, verifyPassword } from './password';

export async function verifyTradePartnerLogin(
	tradePartner: TradePartnerAuth,
	password: string
): Promise<boolean> {
	if (verifyPassword(password, tradePartner.password_hash)) return true;

	const normalizedAttempt = normalizeClientPhonePassword(password);
	if (!normalizedAttempt) return false;

	if (normalizedAttempt !== password && verifyPassword(normalizedAttempt, tradePartner.password_hash)) {
		return true;
	}

	const normalizedStoredPhone = normalizeClientPhonePassword(tradePartner.phone);
	if (!normalizedStoredPhone || normalizedStoredPhone !== normalizedAttempt) return false;

	try {
		await setTradePartnerPassword(tradePartner.id, hashPassword(normalizedAttempt));
		return true;
	} catch (err) {
		console.error('Failed to seed trade partner password from phone', {
			id: tradePartner.id,
			error: err
		});
		return false;
	}
}
