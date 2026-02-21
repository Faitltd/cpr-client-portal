type LogData = Record<string, unknown>;

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

type Logger = {
	info: (message: string, data?: LogData) => void;
	warn: (message: string, data?: LogData) => void;
	error: (message: string, data?: LogData) => void;
	debug: (message: string, data?: LogData) => void;
};

export function createLogger(module: string): Logger {
	const emit = (level: LogLevel, message: string, data?: LogData) => {
		if (level === 'debug' && process.env.NODE_ENV === 'production') return;
		const payload = {
			timestamp: new Date().toISOString(),
			level,
			module,
			message,
			...(data ?? {})
		};
		const line = JSON.stringify(payload);
		if (level === 'warn') console.warn(line);
		else if (level === 'error') console.error(line);
		else console.log(line);
	};

	return {
		info: (message, data) => emit('info', message, data),
		warn: (message, data) => emit('warn', message, data),
		error: (message, data) => emit('error', message, data),
		debug: (message, data) => emit('debug', message, data)
	};
}
