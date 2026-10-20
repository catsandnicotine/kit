/** Directory enumeration supported by the browser's origin-private filesystem. */
export interface MediaDirectoryHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}
