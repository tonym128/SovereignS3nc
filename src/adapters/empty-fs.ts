export const ensureDir = async () => {};
export const pathExists = async () => false;
export const writeJson = async () => {};
export const readJson = async () => ({});
export const readFile = async () => new Uint8Array();
export const writeFile = async () => {};
export const unlink = async () => {};
export const remove = async () => {};
export const readdir = async () => [];
export const stat = async () => ({ isFile: () => false, isDirectory: () => false, size: 0, mtime: new Date() });

const emptyFs = {
    ensureDir,
    pathExists,
    writeJson,
    readJson,
    readFile,
    writeFile,
    remove,
    readdir,
    stat
};

export default emptyFs;
