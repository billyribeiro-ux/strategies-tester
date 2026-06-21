/**
 * Trigger a browser download for an in-memory blob. Pure DOM side effect — no
 * navigation, no server round trip. Safe to call only in the browser.
 */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.rel = 'noopener';
		anchor.style.display = 'none';
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		// Defer revocation so the click has a chance to start the download.
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}
