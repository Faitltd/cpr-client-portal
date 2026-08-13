import { describe, expect, it } from 'vitest';
import {
	CONVERT_ERROR_MESSAGES,
	CONVERT_ERROR_STATUS,
	ConversionError,
	SUPPORTED_DXF_VERSIONS,
	contentDispositionFor,
	converterConfigured,
	converterHealth,
	convertDwgToDxf,
	dwgVersionMarker,
	dxfVersion,
	hasDwgExtension,
	looksLikeDwg,
	maxUploadBytes,
	newJobId,
	sanitizeBaseName,
	validateUpload
} from './cad-convert';

/** Minimal DWG-looking payload: 6-byte version marker plus filler. */
function dwgBytes(marker = 'AC1032', extra = 512): Uint8Array {
	const head = Buffer.from(marker, 'latin1');
	return new Uint8Array(Buffer.concat([head, Buffer.alloc(extra, 0)]));
}

describe('hasDwgExtension', () => {
	it('accepts lowercase and uppercase extensions', () => {
		expect(hasDwgExtension('Kitchen.dwg')).toBe(true);
		expect(hasDwgExtension('KITCHEN.DWG')).toBe(true);
		expect(hasDwgExtension('Kitchen.DwG')).toBe(true);
	});

	it('rejects other extensions', () => {
		expect(hasDwgExtension('Kitchen.dxf')).toBe(false);
		expect(hasDwgExtension('Kitchen.dwg.exe')).toBe(false);
		expect(hasDwgExtension('Kitchen')).toBe(false);
	});
});

describe('looksLikeDwg', () => {
	it('accepts real DWG version markers', () => {
		for (const marker of ['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032']) {
			expect(looksLikeDwg(dwgBytes(marker))).toBe(true);
		}
	});

	it('rejects executables and other formats renamed to .dwg', () => {
		expect(looksLikeDwg(new Uint8Array(Buffer.from('MZ\x90\x00\x03\x00', 'latin1')))).toBe(
			false
		);
		expect(looksLikeDwg(new Uint8Array(Buffer.from('%PDF-1', 'latin1')))).toBe(false);
		expect(looksLikeDwg(new Uint8Array(Buffer.from('\x7fELF\x02\x01', 'latin1')))).toBe(false);
	});

	it('rejects truncated headers', () => {
		expect(looksLikeDwg(new Uint8Array())).toBe(false);
		expect(looksLikeDwg(new Uint8Array(Buffer.from('AC10', 'latin1')))).toBe(false);
	});
});

describe('dwgVersionMarker', () => {
	it('returns the printable marker for logging', () => {
		expect(dwgVersionMarker(dwgBytes('AC1027'))).toBe('AC1027');
	});

	it('returns null for binary garbage', () => {
		expect(dwgVersionMarker(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBeNull();
	});
});

describe('sanitizeBaseName', () => {
	it('drops the .dwg extension', () => {
		expect(sanitizeBaseName('Johnson-Kitchen.dwg')).toBe('Johnson-Kitchen');
		expect(sanitizeBaseName('Johnson-Kitchen.DWG')).toBe('Johnson-Kitchen');
	});

	it('keeps spaces in normal filenames', () => {
		expect(sanitizeBaseName('Smith Residence.dwg')).toBe('Smith Residence');
	});

	it('keeps Unicode characters', () => {
		expect(sanitizeBaseName('Cocina Muñoz.dwg')).toBe('Cocina Muñoz');
	});

	it('defeats path traversal', () => {
		expect(sanitizeBaseName('../../etc/passwd')).toBe('passwd');
		expect(sanitizeBaseName('..\\..\\windows\\system32\\config.dwg')).toBe('config');
		expect(sanitizeBaseName('/tmp/evil.dwg')).toBe('evil');
		expect(sanitizeBaseName('....//....//evil.dwg')).not.toContain('/');
	});

	it('falls back when nothing usable remains', () => {
		expect(sanitizeBaseName('.dwg')).toBe('drawing');
		expect(sanitizeBaseName('')).toBe('drawing');
		expect(sanitizeBaseName('///')).toBe('drawing');
	});

	it('caps absurdly long names', () => {
		expect(sanitizeBaseName(`${'a'.repeat(500)}.dwg`).length).toBe(120);
	});
});

describe('contentDispositionFor', () => {
	it('emits an ASCII fallback and a UTF-8 name', () => {
		const header = contentDispositionFor('Smith Residence');
		expect(header).toContain('filename="Smith Residence.dxf"');
		expect(header).toContain("filename*=UTF-8''Smith%20Residence.dxf");
	});

	it('strips quotes from the ASCII fallback', () => {
		const header = contentDispositionFor('Odd"Name');
		expect(header).toContain('filename="Odd_Name.dxf"');
	});

	it('percent-encodes Unicode', () => {
		const header = contentDispositionFor('Cocina Muñoz');
		expect(header).toContain("filename*=UTF-8''Cocina%20Mu%C3%B1oz.dxf");
		expect(header).toContain('filename="Cocina Mu_oz.dxf"');
	});
});

describe('validateUpload', () => {
	const head = dwgBytes().subarray(0, 6);

	it('passes a plausible DWG', () => {
		expect(validateUpload({ fileName: 'Kitchen.dwg', size: 2048, head })).toBeNull();
	});

	it('rejects a non-DWG extension', () => {
		expect(validateUpload({ fileName: 'Kitchen.pdf', size: 2048, head })).toBe('invalid_extension');
	});

	it('rejects zero-byte files', () => {
		expect(validateUpload({ fileName: 'Kitchen.dwg', size: 0, head })).toBe('empty_file');
	});

	it('rejects files over the limit', () => {
		expect(validateUpload({ fileName: 'Kitchen.dwg', size: maxUploadBytes() + 1, head })).toBe(
			'too_large'
		);
	});

	it('rejects a bad header even with the right extension', () => {
		const fake = new Uint8Array(Buffer.from('MZ\x90\x00\x03\x00', 'latin1'));
		expect(validateUpload({ fileName: 'Kitchen.dwg', size: 2048, head: fake })).toBe('invalid_dwg');
	});
});

describe('convertDwgToDxf validation path', () => {
	it('rejects malformed DWG bytes before invoking the converter', async () => {
		await expect(
			convertDwgToDxf({
				bytes: new Uint8Array(Buffer.from('not a dwg at all', 'latin1')),
				fileName: 'Kitchen.dwg'
			})
		).rejects.toMatchObject({ code: 'invalid_dwg' });
	});

	it('rejects a wrong extension before invoking the converter', async () => {
		await expect(
			convertDwgToDxf({ bytes: dwgBytes(), fileName: 'Kitchen.dxf' })
		).rejects.toMatchObject({ code: 'invalid_extension' });
	});

	it('rejects empty uploads', async () => {
		await expect(
			convertDwgToDxf({ bytes: new Uint8Array(), fileName: 'Kitchen.dwg' })
		).rejects.toMatchObject({ code: 'empty_file' });
	});

	it('reports converter_missing when the service is not configured', async () => {
		// No CAD_CONVERTER_URL / CAD_CONVERTER_TOKEN in the test env, so this
		// must fail before any network call is attempted.
		expect(converterConfigured()).toBe(false);
		await expect(
			convertDwgToDxf({ bytes: dwgBytes(), fileName: 'Kitchen.dwg' })
		).rejects.toMatchObject({ code: 'converter_missing' });
	});

	it('reports converter_missing from the health probe when unconfigured', async () => {
		const health = await converterHealth();
		expect(health.available).toBe(false);
		expect(health.configured).toBe(false);
		expect(health.detail).toContain('CAD_CONVERTER_URL');
	});
});

describe('error surface', () => {
	it('never leaks raw tool output', () => {
		for (const message of Object.values(CONVERT_ERROR_MESSAGES)) {
			expect(message).not.toMatch(/segmentation|subprocess|exit status|stderr|Traceback/i);
		}
	});

	it('maps every code to a status', () => {
		for (const code of Object.keys(CONVERT_ERROR_MESSAGES)) {
			expect(CONVERT_ERROR_STATUS[code as keyof typeof CONVERT_ERROR_STATUS]).toBeGreaterThan(399);
		}
	});

	it('exposes user copy and status on the error object', () => {
		const err = new ConversionError('timeout', 'CAD-12345678', 'raw detail');
		expect(err.userMessage).toBe(CONVERT_ERROR_MESSAGES.timeout);
		expect(err.status).toBe(504);
		expect(err.jobId).toBe('CAD-12345678');
	});
});

describe('dxfVersion', () => {
	it('defaults to a supported target', () => {
		expect(SUPPORTED_DXF_VERSIONS).toContain(dxfVersion());
	});

	it('includes r2018, which ODA File Converter writes cleanly', () => {
		expect(SUPPORTED_DXF_VERSIONS).toContain('r2018');
	});
});

describe('newJobId', () => {
	it('formats as CAD-XXXXXXXX', () => {
		expect(newJobId()).toMatch(/^CAD-[0-9A-F]{8}$/);
	});

	it('is unique across calls', () => {
		const ids = new Set(Array.from({ length: 200 }, () => newJobId()));
		expect(ids.size).toBe(200);
	});
});
