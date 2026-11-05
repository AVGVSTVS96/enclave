import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import * as z from "zod";

import { decode, encode } from "./base64url.ts";
import { generateKeyPair, open, seal } from "./hpke.ts";

export const itemSchema = z.record(z.string(), z.string());

export type Item = z.infer<typeof itemSchema>;

interface KeyPair {
  publicKey: Uint8Array<ArrayBuffer>;
  privateKey: Uint8Array<ArrayBuffer>;
}

const savedKeys = z.object({ publicKey: z.string(), privateKey: z.string() });

const text = new TextEncoder();
const info = text.encode("enclave item");
const extension = ".enclave";

const isErrno = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const unlessMissing = async <T>(read: Promise<T>): Promise<T | undefined> => {
  try {
    return await read;
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

const linkUnlessThere = async (from: string, to: string) => {
  try {
    await link(from, to);
  } catch (error) {
    if (!isErrno(error) || error.code !== "EEXIST") {
      throw error;
    }
  } finally {
    await rm(from);
  }
};

export class Store {
  readonly dir: string;
  private readonly folder: string;
  private keys?: Promise<KeyPair> | undefined;

  constructor(dir: string, folder = "items") {
    this.dir = dir;
    this.folder = folder;
  }

  async get(name: string): Promise<Item | undefined> {
    const sealed = await unlessMissing(readFile(this.path(name)));

    if (!sealed) {
      return undefined;
    }

    const { privateKey } = await this.key();
    const plaintext = await open(privateKey, info, text.encode(name), new Uint8Array(sealed));

    return itemSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  }

  async put(name: string, item: Item) {
    const { publicKey } = await this.key();

    const sealed = await seal(
      publicKey,
      info,
      text.encode(name),
      text.encode(JSON.stringify(item)),
    );

    const temporary = await this.temporary(sealed);

    await rename(temporary, this.path(name));
  }

  async remove(name: string) {
    await rm(this.path(name), { force: true });
  }

  async names() {
    const files = (await unlessMissing(readdir(path.join(this.dir, this.folder)))) ?? [];

    return files
      .filter((file) => file.endsWith(extension))
      .map((file) => decodeURIComponent(file.slice(0, -extension.length)));
  }

  private path(name: string) {
    return path.join(this.dir, this.folder, encodeURIComponent(name) + extension);
  }

  private async key() {
    this.keys ??= this.load();

    try {
      return await this.keys;
    } catch (error) {
      this.keys = undefined;
      throw error;
    }
  }

  private async load(): Promise<KeyPair> {
    const file = path.join(this.dir, "key.json");
    const saved = await unlessMissing(readFile(file, "utf-8"));

    if (saved !== undefined && saved !== "") {
      const { publicKey, privateKey } = savedKeys.parse(JSON.parse(saved));

      return { publicKey: decode(publicKey), privateKey: decode(privateKey) };
    }

    const { publicKey, privateKey } = await generateKeyPair();

    const temporary = await this.temporary(
      JSON.stringify({ publicKey: encode(publicKey), privateKey: encode(privateKey) }),
    );

    await linkUnlessThere(temporary, file);

    return await this.load();
  }

  private async temporary(data: string | Uint8Array) {
    const file = path.join(this.dir, this.folder, `${randomUUID()}.tmp`);

    await mkdir(path.join(this.dir, this.folder), { mode: 0o700, recursive: true });
    await writeFile(file, data, { mode: 0o600 });

    return file;
  }
}
