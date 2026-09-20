declare module 'adm-zip' {
  export default class AdmZip {
    constructor(zipPath?: string | Buffer)
    addFile(entryName: string, content: Buffer, comment?: string, attr?: number): unknown
    addLocalFolder(localPath: string, zipPath?: string, filter?: RegExp | ((filename: string) => boolean)): void
    addLocalFile(localPath: string, zipPath?: string, zipName?: string, comment?: string): void
    toBuffer(): Buffer
    toBufferPromise(): Promise<Buffer>
    readAsText(entry: string, encoding?: string): string
    extractAllTo(targetPath: string, overwrite?: boolean, keepOriginalPermission?: boolean): void
  }
}
