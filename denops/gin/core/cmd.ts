import { Denops, helper } from "../deps.ts";

export async function normCmdArgs(
  denops: Denops,
  args: string[],
): Promise<string[]> {
  await helper.load(denops, new URL("./cmd.vim", import.meta.url));
  // To reduce RPC, cache result of an arg which starts from '%' or '#'
  const cache: Map<string, Promise<string>> = new Map();
  return await Promise.all(args.map((arg) => normCmdArg(denops, arg, cache)));
}

async function normCmdArg(
  denops: Denops,
  arg: string,
  cache: Map<string, Promise<string>>,
): Promise<string> {
  if (cache.has(arg)) {
    return await cache.get(arg)!;
  }
  if (arg.startsWith("%") || arg.startsWith("#")) {
    const p = denops.call("GinExpand", arg) as Promise<string>;
    cache.set(arg, p);
    return await p;
  }
  return arg.replaceAll(/^\\(%|#)/g, "$1");
}