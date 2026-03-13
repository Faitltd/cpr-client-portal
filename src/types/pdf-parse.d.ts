declare module 'pdf-parse' {
	interface PDFData {
		text: string;
		numpages: number;
	}
	function parse(buf: Buffer): Promise<PDFData>;
	export = parse;
}
