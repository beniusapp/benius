export function classworkResource(value: unknown): 'pdf' | 'video' | 'image' | 'file' | null;
export function safeClassworkUrl(value: unknown, domain: unknown): string | null;
export function classworkDateAllowed(date: string, today: string): boolean;