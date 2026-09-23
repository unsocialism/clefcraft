/**
 * Handing a file to the browser.
 *
 * A link that is clicked and thrown away is still the only way to save a
 * file a page made up itself. The object URL is revoked on a later tick
 * rather than straight after the click: Safari has not finished with it
 * when `click()` returns, and revoking too early saves an empty file.
 */
export function downloadFile(data: BlobPart, options: { name: string; type: string }): void {
  const url = URL.createObjectURL(new Blob([data], { type: options.type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = options.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
