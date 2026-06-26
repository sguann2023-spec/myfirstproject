declare module 'adm-zip' {
  export default class AdmZip {
    constructor(zipPath?: string)
    addLocalFolder(localPath: string, zipPath?: string, filter?: RegExp | ((filename: string) => boolean)): void
    addLocalFile(localPath: string, zipPath?: string, zipName?: string, comment?: string): void
    toBuffer(): Buffer
    extractAllTo(targetPath: string, overwrite?: boolean, keepOriginalPermission?: boolean): void
  }
}
